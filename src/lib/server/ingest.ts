import { validateTagIds, changePhotoTags, legacyDayTag } from './tags';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fsp, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { storage, withStorageLock } from './storage';
import { storeFile, assertScratchSpace } from './blob-store';
import { randomId } from './ids';
import { enqueue } from './jobs';
import { probeDimensions } from './images';
import { normalizeStem, RAW_EXTENSIONS, IMAGE_EXTENSIONS, type VariantRole, type UploadRole, sidecarRole } from '$shared/stem';
import { getSettings } from './settings';
import { photoKey } from '$shared/photo-key';
import { listImportPhotos } from './import-photos';
import { MAX_XMP_BYTES, readSidecarMetadata } from './sidecars';
import { parseShootDay, type ShootDay } from '$shared/shoot-days';
import { versionFor, archiveFileRevision, deliverySourceChanged, pauseDelivery } from './delivery';

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', dng: 'image/x-adobe-dng' };

export class IngestError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface IngestResult {
  status: 'created' | 'replaced' | 'unchanged';
  photoId: number; fileId: number; stem: string; role: UploadRole; bytes: number; sha256: string;
}

/** Magic-byte sniff so a renamed .exe cannot become an "image". RAW formats are TIFF- or ISO-BMFF-based or have vendor headers. */
function sniff(head: Buffer, ext: string): boolean {
  const hex = head.subarray(0, 12).toString('hex');
  const ascii = head.subarray(0, 16).toString('latin1');
  if (['jpg', 'jpeg'].includes(ext)) return hex.startsWith('ffd8ff');
  if (ext === 'png') return hex.startsWith('89504e470d0a1a0a');
  if (ext === 'webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (['tif', 'tiff', 'dng', 'cr2', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'pef', 'ptx', 'srw', 'dcr', 'kdc', 'erf', 'mef', 'mrw', '3fr', 'iiq'].includes(ext))
    return hex.startsWith('49492a00') || hex.startsWith('4d4d002a') || hex.startsWith('4d4d002b') || hex.startsWith('49494f52') || ascii.startsWith('\0MRM') || hex.startsWith('49495500');
  if (['heic', 'heif', 'avif', 'cr3', 'crw'].includes(ext)) return ascii.slice(4, 8) === 'ftyp' || ascii.slice(6, 8) === 'HE';
  if (ext === 'raf') return ascii.startsWith('FUJIFILM');
  if (ext === 'rw2') return hex.startsWith('49495500');
  if (ext === 'orf') return hex.startsWith('4949524f') || hex.startsWith('4949524f') || hex.startsWith('4d4d4f52') || hex.startsWith('49492a00');
  if (ext === 'x3f') return ascii.startsWith('FOVb');
  if (ext === 'fff') return hex.startsWith('49492a00');
  return true; // remaining RAW types: accept on extension
}

export interface UploadInput {
  eventId: number; galleryId: number; filename: string; role: UploadRole | null; body: ReadableStream<Uint8Array> | null; declaredBytes: number | null;
  /** Long edge hint from the browser for role inference on unsuffixed JPEGs. */
  longEdgePx?: number | null;
  /** Different bytes for an existing photo/role require an explicit owner choice. */
  replacement?: 'reject' | 'replace';
  /** Preserve a filename collision as a separate photo. Never interpreted as a path. */
  stemOverride?: string;
  /** Optional batch label for NEW photos only. Reimports never change the owner's labels. */
  shootDay?: ShootDay | null;
  tagIds?: number[];
  /** Verified resumable session contract, never trusted as a byte checksum. */
  expectedSha256?: string;
  expectedVersion?: string | null;
  expectedPhotoId?: number | null;
}

/**
 * Stream one uploaded file to a temp path (hashing on the fly), verify it, then upsert photo + photo_file
 * by (event, filename) and (photo, role). Idempotent by sha256: re-uploading the same bytes is a no-op.
 */
export async function ingestUpload(input: UploadInput): Promise<IngestResult> {
  try { validateTagIds(input.eventId, input.tagIds ?? []); } catch (err) { throw new IngestError(400, (err as Error).message); }
  let shootDay: ShootDay | null;
  try { shootDay = parseShootDay(input.shootDay); } catch (err) { throw new IngestError(400, (err as Error).message); }
  const gallery = db.select().from(schema.galleries).where(and(eq(schema.galleries.id, input.galleryId), eq(schema.galleries.eventId, input.eventId))).get();
  if (!gallery) throw new IngestError(404, 'gallery not found');
  if (gallery.isArchived) throw new IngestError(409, 'This collection is archived. Restore it or choose an active collection for this upload.');
  const event = db.select().from(schema.events).where(eq(schema.events.id, input.eventId)).get()!;
  const filename = path.basename(input.filename).normalize('NFC');
  const patterns = { ...getSettings().stemSuffixPatterns, ...(event.stemSuffixPatterns ?? {}) } as Record<string, VariantRole>;
  const normalized = normalizeStem(filename, patterns);
  const { ext, roleHint } = normalized;
  const sidecar = sidecarRole(filename);
  const baseKey = photoKey(filename);
  const stem = input.stemOverride?.normalize('NFC').toLowerCase().trim() || baseKey;
  if (stem.length > 200 || /[\\/\x00-\x1f]/.test(stem)) throw new IngestError(400, 'invalid photo name');
  if (!stem) throw new IngestError(400, 'empty filename');
  if (!IMAGE_EXTENSIONS.has(ext) && !RAW_EXTENSIONS.has(ext) && !sidecar) throw new IngestError(415, `unsupported file type .${ext}`);
  if (!input.body) throw new IngestError(400, 'empty body');
  const role: UploadRole = sidecar ?? input.role ?? (RAW_EXTENSIONS.has(ext) ? 'raw' : roleHint ?? (input.longEdgePx != null ? (input.longEdgePx < 2500 ? 'social' : 'print') : 'print'));
  if (!sidecar && !versionFor(input.eventId, role)) throw new IngestError(400, 'Choose a delivery version in this project.');
  if (role !== 'raw' && RAW_EXTENSIONS.has(ext)) throw new IngestError(400, 'RAW files can only be the RAW variant');
  const maxBytes = sidecar === 'xmp' ? Math.min(env.maxUploadBytes, MAX_XMP_BYTES) : env.maxUploadBytes;
  if (input.declaredBytes && input.declaredBytes > maxBytes) throw new IngestError(413, sidecar === 'xmp' ? 'XMP sidecars must be 8 MB or smaller' : 'file too large');

  // Stream to tmp while hashing and sniffing the head.
  const tmpRel = storage.tmp(`up-${randomId(10)}.${ext}`);
  const tmpAbs = storage.abs(tmpRel);
  mkdirSync(path.dirname(tmpAbs), { recursive: true });
  await assertScratchSpace(input.declaredBytes ?? Math.min(maxBytes, 64 * 1024 * 1024));
  const hash = createHash('sha256');
  let bytes = 0; let checkedBytes = 0; let head: Buffer | null = null;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) return cb(new IngestError(413, sidecar === 'xmp' ? 'XMP sidecars must be 8 MB or smaller' : 'file too large'));
      if (!head) head = Buffer.from(chunk.subarray(0, 16)); else if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
      hash.update(chunk);
      if (bytes - checkedBytes >= 16 * 1024 * 1024) {
        checkedBytes = bytes;
        assertScratchSpace(16 * 1024 * 1024).then(() => cb(null, chunk), (e) => cb(e));
      } else cb(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(input.body as import('stream/web').ReadableStream), tap, createWriteStream(tmpAbs, { flags: 'wx' }));
    if (bytes === 0) throw new IngestError(400, 'empty file');
    if (!sidecar && (!head || !sniff(head, ext))) throw new IngestError(415, 'file content does not match its extension');
    const sha256 = hash.digest('hex');
    if (input.expectedSha256 && sha256 !== input.expectedSha256) throw new IngestError(422, 'File verification failed. Reselect the source file and retry.');
    if (input.declaredBytes !== null && bytes !== input.declaredBytes) throw new IngestError(400, 'The file was not received completely. Retry this upload.');
    const dims = sidecar ? { width: null, height: null, takenAt: null } : await probeDimensions(tmpAbs, ext);
    const sidecarData = sidecar ? await readSidecarMetadata(tmpAbs, sidecar) : null;

    // Publish immutable bytes BEFORE committing metadata. A crash here leaves an unreferenced
    // object, never a successful row pointing at absent or different bytes. Installing the same
    // hash again also repairs a missing/corrupt object after an interrupted earlier upload.
    const newRel = storage.originalVersion(gallery.eventId, sha256, ext);
    return await withStorageLock(newRel, async () => {
    await storeFile(newRel, tmpAbs, { sha256, bytes, mime: MIME[ext] ?? 'application/octet-stream' });
    return sqlite.transaction((): IngestResult => {
      const now = nowIso();
      const currentGallery = db.select().from(schema.galleries).where(eq(schema.galleries.id, gallery.id)).get();
      if (!currentGallery || currentGallery.isArchived) throw new IngestError(409, 'This collection changed while uploading. Choose an active collection and retry; nothing was replaced.');
      // Match across the entire event, not whichever collection currently contains the photo.
      // Explicit Keep-separate keys bypass aliases, so they cannot replace the original.
      const separate = stem !== baseKey;
      let candidates = listImportPhotos(input.eventId).filter((p) => separate ? p.stem === stem : p.matchKeys.includes(stem));
      if (candidates.length > 1) {
        // Exact-byte retries can safely recover their original variant despite a later merge.
        const identical = candidates.filter((p) => sidecar
          ? p.sidecars.some((f) => f.kind === sidecar && f.sha256 === sha256)
          : p.files.some((f) => f.role === role && f.sha256 === sha256));
        if (identical.length === 1) candidates = identical;
      }
      if (candidates.length > 1) throw new IngestError(409, `More than one photo in this event matches “${stem}”. Nothing was replaced. Keep this as a separate photo or resolve the duplicate filenames first.`);
      let photo: typeof schema.photos.$inferSelect | undefined = candidates[0];
      if (input.expectedPhotoId && photo?.id !== input.expectedPhotoId) throw new IngestError(409, 'This photo changed during the upload. Review the batch again.');
      if (input.expectedVersion !== undefined) {
        const current = photo && (sidecar ? candidates[0].sidecars.find(f => f.kind === sidecar) : candidates[0].files.find(f => f.role === role));
        if ((current?.sha256 ?? null) !== input.expectedVersion && current?.sha256 !== sha256 && !(input.expectedVersion === null && current && 'origin' in current && current.origin === 'generated'))
          throw new IngestError(409, 'Another upload changed this version. Review the batch before replacing it.');
      }
      if (!photo) {
        photo = db.insert(schema.photos).values({ galleryId: gallery.id, stem, displayName: stem, takenAt: dims.takenAt, shootDay, renditionStatus: sidecar ? 'nosource' : 'pending', createdAt: now, updatedAt: now }).returning().get();
        // Destination is for new photos only. Later uploads never undo sorting or change
        // publication by restoring intake / adding an unrelated collection membership.
        db.insert(schema.galleryPhotos).values({ galleryId: gallery.id, photoId: photo.id }).run();
        const tagIds = [...(input.tagIds ?? []), ...(shootDay ? [legacyDayTag(input.eventId,shootDay)] : [])];
        if (tagIds.length) changePhotoTags(input.eventId,[photo.id],tagIds,"add");
      }
      if (sidecar && sidecarData) {
        const existing = db.select().from(schema.photoSidecars).where(and(eq(schema.photoSidecars.photoId, photo.id), eq(schema.photoSidecars.kind, sidecar))).get();
        if (existing && existing.sha256 !== sha256 && input.replacement !== 'replace') {
          throw new IngestError(409, `“${stem}” already has an ${sidecar.toUpperCase()} sidecar. Skip this file or explicitly choose Update existing versions.`);
        }
        const unchanged = existing?.sha256 === sha256;
        const values = { originalFilename: filename, ext, mime: 'application/octet-stream', bytes, sha256, storagePath: newRel, ...sidecarData, updatedAt: now };
        const saved = existing
          ? unchanged ? existing : db.update(schema.photoSidecars).set(values).where(eq(schema.photoSidecars.id, existing.id)).returning().get()
          : db.insert(schema.photoSidecars).values({ photoId: photo.id, kind: sidecar, ...values, createdAt: now }).returning().get();
        // Sidecar changes never render or alter dimensions, the finished JPEG, or collections.
        return { status: unchanged ? 'unchanged' : existing ? 'replaced' : 'created', photoId: photo.id, fileId: saved.id, stem: photo.stem, role: sidecar, bytes, sha256 };
      }
      const existing = db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.photoId, photo.id), eq(schema.photoFiles.role, role))).get();
      if (existing && existing.sha256 !== sha256 && input.replacement !== 'replace' && !(input.expectedVersion === null && existing.origin === 'generated')) {
        throw new IngestError(409, `“${stem}” already has a ${role} file. Keep both photos, skip this file, or explicitly choose Replace.`);
      }
      const unchanged = existing?.sha256 === sha256;
      const previousRevision = existing ? archiveFileRevision(existing) : null;
      const values = { origin: 'uploaded' as const, revisionId: unchanged && existing?.origin === 'uploaded' ? previousRevision : null, sourceFileId: null, sourceSha256: null, recipeHash: null, recipe: null, available: 1, needsReview: 0, originalFilename: filename, ext, mime: MIME[ext] ?? 'application/octet-stream', bytes, sha256, width: dims.width, height: dims.height, storagePath: newRel };
      const file = existing
        ? db.update(schema.photoFiles).set(values).where(eq(schema.photoFiles.id, existing.id)).returning().get()
        : db.insert(schema.photoFiles).values({ photoId: photo.id, role, ...values, createdAt: now }).returning().get();
      deliverySourceChanged(photo.id, role, !unchanged && !!existing);
      const needsRender = !unchanged || photo.renditionStatus !== 'ready';
      if (needsRender) {
        db.update(schema.photos).set({ renditionStatus: 'pending', takenAt: photo.takenAt ?? dims.takenAt, updatedAt: now }).where(eq(schema.photos.id, photo.id)).run();
        // Same SQLite transaction as the file pointer: a crash cannot lose this render request.
        enqueue('render_photo', { photoId: photo.id }, { dedupeKey: `render:${photo.id}`, priority: 5 });
      }
      // Historical versions are intentionally retained: order snapshots refer to their SHA.
      return { status: unchanged ? 'unchanged' : existing ? 'replaced' : 'created', photoId: photo.id, fileId: file.id, stem: photo.stem, role, bytes, sha256 };
    })();
    });
  } catch (err) {
    await fsp.rm(tmpAbs, { force: true });
    throw err;
  }
}

function undeliveredReferences(photoId: number): number {
  const row = sqlite.prepare(`select count(*) n from order_item_cells c join order_item_sheets s on s.id = c.order_item_sheet_id join order_items i on i.id = s.order_item_id join orders o on o.id = i.order_id where c.photo_id = ? and o.status not in ('delivered','cancelled')`).get(photoId) as { n: number };
  return row.n;
}

export async function deletePhoto(photoId: number): Promise<{ ok: boolean; reason?: string }> {
  const photo = db.select().from(schema.photos).where(eq(schema.photos.id, photoId)).get();
  if (!photo) return { ok: true };
  const gallery = db.select().from(schema.galleries).where(eq(schema.galleries.id, photo.galleryId)).get()!;
  const referenced = sqlite.prepare(`select count(*) n from order_item_cells c join order_item_sheets s on s.id = c.order_item_sheet_id join order_items i on i.id = s.order_item_id join orders o on o.id = i.order_id where c.photo_id = ? and o.status not in ('delivered','cancelled')`).get(photoId) as { n: number };
  if (referenced.n > 0) return { ok: false, reason: `photo is in ${referenced.n} undelivered order cell(s)` };
  const sidecars = db.select({ storagePath: schema.photoSidecars.storagePath }).from(schema.photoSidecars).where(eq(schema.photoSidecars.photoId, photoId)).all();
  db.delete(schema.photos).where(eq(schema.photos.id, photoId)).run();
  enqueue('delete_files', { paths: [storage.photoDir(gallery.eventId, photoId), storage.derivativeDir(gallery.eventId, photoId), ...sidecars.map((sidecar) => sidecar.storagePath)] });
  return { ok: true };
}

export async function deletePhotoFile(fileId: number): Promise<void> {
  sqlite.transaction(() => {
    const f = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.id, fileId)).get();
    if (!f) return;
    const variants = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.photoId, f.photoId)).all();
    if ((f.role === 'print' || variants.length === 1) && undeliveredReferences(f.photoId)) {
      throw new IngestError(409, 'This photo is needed for an unfinished order. Finish or cancel the order before removing its print master.');
    }
    archiveFileRevision(f);
    const eventId = (sqlite.prepare('SELECT g.event_id id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=?').get(f.photoId) as {id:number}).id;
    pauseDelivery(eventId, f.photoId, f.role);
    db.delete(schema.photoFiles).where(eq(schema.photoFiles.id, fileId)).run();
    deliverySourceChanged(f.photoId, f.role, true);
    // Deletion workers recheck references; reuploading cannot delete the new version.
    enqueue('delete_files', { paths: [f.storagePath] });
    if (variants.length === 1 && !db.select({ id: schema.photoSidecars.id }).from(schema.photoSidecars).where(eq(schema.photoSidecars.photoId, f.photoId)).get()) db.delete(schema.photos).where(eq(schema.photos.id, f.photoId)).run();
    else if (variants.length === 1) {
      // Keep private editing companions when the last image is removed; a later RAW can
      // reattach to this same photo. Never show stale derivatives as a current image.
      db.update(schema.photos).set({ renditionStatus: 'nosource', renditionHash: null, renderSourceRole: null, width: null, height: null, updatedAt: nowIso() }).where(eq(schema.photos.id, f.photoId)).run();
    }
    else {
      db.update(schema.photos).set({ renditionStatus: 'pending', updatedAt: nowIso() }).where(eq(schema.photos.id, f.photoId)).run();
      enqueue('render_photo', { photoId: f.photoId }, { dedupeKey: `render:${f.photoId}` });
    }
  })();
}
