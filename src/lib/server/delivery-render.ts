import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { storage, withStorageLock } from './storage';
import { assertScratchSpace, materializeObject, storeFile } from './blob-store';
import { archiveFileRevision, currentFile, versionFor } from './delivery';
import { nowIso } from './env';
import { randomId } from './ids';
import { enqueue } from './jobs';
import { withImageBudget } from './image-budget';
import { recipeSchema, type DeliveryRecipe } from '$shared/delivery';

/** Explicit SDR/JPEG recipe; never mutate the authored input or inherit private metadata. */
export async function renderDeliveryJpeg(input: string, recipe: DeliveryRecipe, output: string) {
  const settings = recipeSchema.parse(recipe);
  const image = sharp(input, { limitInputPixels: 100e6, failOn: 'warning' });
  const meta = await image.metadata();
  if (meta.format !== 'jpeg' || meta.depth !== 'uchar' || meta.gainMap || /hdrgm:|hdrgainmap|GainMap/.test(meta.xmp?.toString() ?? ''))
    throw new Error('Automatic copies need a conventional SDR JPEG. Upload a Lightroom export for this version.');
  let pipeline = image.rotate().resize({ width: settings.width, height: settings.height, fit: 'inside', withoutEnlargement: true })
    .withIccProfile('srgb');
  if (settings.sharpening === 'screen') pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.5, m2: 1 });
  if (settings.metadata === 'copyright') {
    const tags = await exiftool.read(input);
    const fields: Record<string, string> = {};
    if (typeof tags.Artist === 'string') fields.Artist = tags.Artist.slice(0, 1000);
    if (typeof tags.Copyright === 'string') fields.Copyright = tags.Copyright.slice(0, 2000);
    if (Object.keys(fields).length) pipeline = pipeline.withExif({ IFD0: fields });
  }
  return pipeline.jpeg({ quality: settings.quality, chromaSubsampling: '4:2:0' }).toFile(output);
}

export async function renderDelivery(eventId: number, photoId: number, role: string, generation: number): Promise<void> {
  return withImageBudget(async () => {
    const state = db.select().from(schema.deliveryStates).where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role))).get();
    if (!state || state.generation !== generation || !state.recipe || !state.sourceFileId || !['queued', 'processing', 'failed'].includes(state.status)) return;
    const source = db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.id, state.sourceFileId), eq(schema.photoFiles.photoId, photoId))).get();
    const owned = sqlite.prepare('SELECT 1 FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=? AND g.event_id=?').get(photoId, eventId);
    if (!owned || !source || source.origin !== 'uploaded' || !source.available || source.sha256 !== state.sourceSha256) return;
    const canPublish = () => {
      const latest = db.select().from(schema.deliveryStates).where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role))).get();
      const input = currentFile(photoId, source.role), output = currentFile(photoId, role);
      return latest?.generation === generation && ['queued', 'processing', 'failed'].includes(latest.status)
        && input?.id === source.id && input.sha256 === source.sha256 && input.origin === 'uploaded' && !!input.available
        && (output?.origin !== 'uploaded' || latest.replaceUploadSha256 === output.sha256) && versionFor(eventId, role)?.mode === 'automatic';
    };
    if (!canPublish()) return;
    db.update(schema.deliveryStates).set({ status: 'processing', lastError: null, updatedAt: nowIso() }).where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role), eq(schema.deliveryStates.generation, generation))).run();
    const temp = storage.abs(storage.tmp(`delivery-${randomId(20)}.jpg`));
    let input: Awaited<ReturnType<typeof materializeObject>> | undefined;
    let stored: string | undefined, published = false;
    const started = Date.now();
    try {
      await assertScratchSpace(128 * 1024 * 1024);
      input = await materializeObject(source.storagePath);
      const result = await renderDeliveryJpeg(input.path, state.recipe, temp);
      const bytes = await fs.readFile(temp), sha256 = createHash('sha256').update(bytes).digest('hex');
      const rel = storage.originalVersion(eventId, sha256, 'jpg');
      await withStorageLock(rel, async () => {
        await storeFile(rel, temp, { sha256, bytes: result.size, mime: 'image/jpeg' });
        stored = rel;
        sqlite.transaction(() => {
          if (!canPublish()) return;
          const old = currentFile(photoId, role);
          if (old) archiveFileRevision(old);
          const values = { originalFilename: `photo-${photoId}-${role}.jpg`, ext: 'jpg', mime: 'image/jpeg', bytes: result.size,
            sha256, width: result.width, height: result.height, storagePath: rel, origin: 'generated' as const, revisionId: null,
            sourceFileId: source.id, sourceSha256: source.sha256, recipe: state.recipe, recipeHash: state.recipeHash, available: 1, needsReview: 0 };
          const file = old ? db.update(schema.photoFiles).set(values).where(eq(schema.photoFiles.id, old.id)).returning().get()
            : db.insert(schema.photoFiles).values({ photoId, role, ...values, createdAt: nowIso() }).returning().get();
          archiveFileRevision(file);
          db.update(schema.deliveryStates).set({ status: 'ready', lastError: null, updatedAt: nowIso() }).where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role), eq(schema.deliveryStates.generation, generation))).run();
          published = true;
        })();
      });
      if (published) console.info(`[delivery] photo=${photoId} version=${role} ms=${Date.now() - started} bytes=${result.size}`);
    } catch (err) {
      if (canPublish()) db.update(schema.deliveryStates).set({ status: 'failed', lastError: err instanceof Error && err.message.startsWith('Automatic copies') ? err.message : 'Could not create this copy. Check source availability and free storage, then retry.', updatedAt: nowIso() })
        .where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role), eq(schema.deliveryStates.generation, generation))).run();
      throw err;
    } finally {
      await fs.rm(temp, { force: true });
      await input?.release();
      if (stored && !published) enqueue('delete_files', { paths: [stored] });
    }
  });
}
