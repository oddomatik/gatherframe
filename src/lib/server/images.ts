import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { enqueue } from './jobs';
import { nowIso } from './env';
import { storage, withStorageLock } from './storage';
import { materializeObject, storeFile, assertScratchSpace } from './blob-store';
import { RAW_EXTENSIONS } from '$shared/stem';
import { randomId } from './ids';
import { withImageBudget } from './image-budget';

sharp.concurrency(2);
const SIZES = { thumb: 400, preview: 1600, web: 2560 } as const;
const SOURCE_PREFERENCE = ['print', 'social', 'raw'];

/** Dimensions (post-rotation) for any accepted file; RAW via ExifTool tags. */
export async function probeDimensions(absPath: string, ext: string): Promise<{ width: number | null; height: number | null; takenAt: string | null }> {
  try {
    if (RAW_EXTENSIONS.has(ext)) {
      const tags = await exiftool.read(absPath);
      const w = (tags.ImageWidth as number | undefined) ?? null, h = (tags.ImageHeight as number | undefined) ?? null;
      const rotated = typeof tags.Orientation === 'number' && tags.Orientation >= 5;
      return { width: rotated ? h : w, height: rotated ? w : h, takenAt: exifDate(tags.DateTimeOriginal ?? tags.CreateDate) };
    }
    const meta = await sharp(absPath, { failOn: 'none', limitInputPixels: 400e6 }).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    let takenAt: string | null = null;
    if (meta.exif) { try { const tags = await exiftool.read(absPath); takenAt = exifDate(tags.DateTimeOriginal ?? tags.CreateDate); } catch { /* ignore */ } }
    return { width: rotated ? meta.height ?? null : meta.width ?? null, height: rotated ? meta.width ?? null : meta.height ?? null, takenAt };
  } catch {
    return { width: null, height: null, takenAt: null };
  }
}

function exifDate(v: unknown): string | null {
  if (!v) return null;
  const anyV = v as { toDate?: () => Date; toISOString?: () => string };
  try {
    if (typeof anyV.toDate === 'function') return anyV.toDate().toISOString();
    if (typeof anyV.toISOString === 'function') return anyV.toISOString();
  } catch { /* ignore */ }
  return null;
}

function preferredSource(photoId: number) {
  const files = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.photoId, photoId)).all();
  const preferred = db.select({ role: schema.events.displaySourceRole }).from(schema.photos)
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .innerJoin(schema.events, eq(schema.events.id, schema.galleries.eventId)).where(eq(schema.photos.id, photoId)).get()?.role;
  const authored = files.filter(f => f.origin === 'uploaded' && f.available);
  return [preferred, ...SOURCE_PREFERENCE].map((role) => authored.find((f) => f.role === role)).find(Boolean) ?? authored[0];
}

/** Explicit, targeted owner retry; pending work is also recovered by the worker sweep. */
export function retryPhotoRendering(photoId: number): boolean {
  const changed = db.update(schema.photos).set({ renditionStatus: 'pending', updatedAt: nowIso() }).where(eq(schema.photos.id, photoId)).run();
  if (!changed.changes) return false;
  enqueue('render_photo', { photoId }, { dedupeKey: `render:${photoId}`, priority: 5 });
  return true;
}

/** Immutable rendition sets, published only while their exact source is still current. */
export async function renderPhoto(photoId: number): Promise<void> {
  return withImageBudget(() => renderPhotoWithinBudget(photoId));
}
async function renderPhotoWithinBudget(photoId: number): Promise<void> {
  const photo = db.select().from(schema.photos).where(eq(schema.photos.id, photoId)).get();
  if (!photo) return;
  const gallery = db.select().from(schema.galleries).where(eq(schema.galleries.id, photo.galleryId)).get();
  if (!gallery) return;
  const source = preferredSource(photoId);
  if (!source) {
    db.update(schema.photos).set({ renditionStatus: 'nosource', updatedAt: nowIso() }).where(eq(schema.photos.id, photoId)).run();
    return;
  }
  const isCurrent = () => {
    const latest = preferredSource(photoId);
    return latest?.id === source.id && latest.sha256 === source.sha256 && latest.storagePath === source.storagePath;
  };
  const version = `v2-${source.sha256}-${randomId(8)}`;
  const dir = storage.abs(storage.tmp(`render-${photoId}-${randomId(10)}`));
  let materialized: Awaited<ReturnType<typeof materializeObject>> | undefined;
  const stored: string[] = [];
  let tmpPreview: string | null = null;
  let published = false;
  try {
    await assertScratchSpace(64 * 1024 * 1024);
    materialized = await materializeObject(source.storagePath);
    let inputPath = materialized.path;
    if (RAW_EXTENSIONS.has(source.ext)) {
      // Camera RAW is never treated as full resolution just because an embedded preview exists.
      tmpPreview = storage.abs(storage.tmp(`rawprev-${photoId}-${randomId(8)}.jpg`));
      let ok = false;
      for (const tag of ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage']) {
        try { await exiftool.extractBinaryTag(tag, inputPath, tmpPreview); ok = (await fsp.stat(tmpPreview)).size > 1000; if (ok) break; } catch { /* try next */ }
      }
      if (!ok) throw new Error('no embedded preview in RAW');
      inputPath = tmpPreview;
    }
    await fsp.mkdir(dir, { recursive: true });
    const base = sharp(inputPath, { failOn: 'none', limitInputPixels: 400e6 }).rotate();
    const meta = await base.metadata();
    // Every render owns its directory, so old and new workers never overwrite one another.
    const outputs = await Promise.allSettled((Object.entries(SIZES) as [keyof typeof SIZES, number][]).map(async ([kind, size]) => {
      const out = path.join(dir, `${kind}.webp`);
      await base.clone().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: kind === 'thumb' ? 78 : 84 }).toFile(out);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(out)) hash.update(chunk);
      const rel = storage.derivative(gallery.eventId, photoId, kind, version);
      const bytes = (await fsp.stat(out)).size;
      await withStorageLock(rel, () => storeFile(rel, out, { sha256: hash.digest('hex'), bytes, mime: 'image/webp' }));
      stored.push(rel);
    }));
    const failed = outputs.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    // This read + update contain no await: replacement commits cannot interleave in this process.
    if (!isCurrent()) return;
    const rotated = (meta.orientation ?? 1) >= 5;
    const dims = source.width && source.height ? { width: source.width, height: source.height }
      : { width: (rotated ? meta.height : meta.width) ?? null, height: (rotated ? meta.width : meta.height) ?? null };
    const result = db.update(schema.photos).set({ renditionStatus: 'ready', renditionHash: version, renderSourceRole: source.role,
      ...dims, updatedAt: nowIso() }).where(eq(schema.photos.id, photoId)).run();
    published = result.changes > 0;
  } catch (err) {
    // A superseded worker must not turn a newer successful photo into "failed".
    if (isCurrent()) db.update(schema.photos).set({ renditionStatus: 'failed', updatedAt: nowIso() }).where(eq(schema.photos.id, photoId)).run();
    throw err;
  } finally {
    if (tmpPreview) await fsp.rm(tmpPreview, { force: true });
    await fsp.rm(dir, { recursive: true, force: true });
    await materialized?.release();
    // Retryable cleanup owns only this unpublished version, never another worker's set.
    if (!published && stored.length) enqueue('delete_files', { paths: stored });
  }
}

export async function shutdownImages(): Promise<void> { try { await exiftool.end(); } catch { /* ignore */ } }
