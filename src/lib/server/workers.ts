import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { lt, eq, and } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { enqueue, registerHandler, startJobRunner } from './jobs';
import { renderPhoto } from './images';
import { deliverPending, scheduleDeliveries } from './notify';
import { storage, withStorageLock } from './storage';
import { deleteObject } from './blob-store';
import { pruneCoverCache } from './cover-images';
import { cleanExpiredTransfers } from './resumable';
import { ensureCatalog } from './catalog';

export function startWorkers(): void {
  const g = globalThis as unknown as { __pk_workers?: boolean };
  if (g.__pk_workers) return;
  g.__pk_workers = true;
  ensureCatalog();

  registerHandler('render_photo', async (p) => { await renderPhoto(Number(p.photoId)); });
  registerHandler('deliver_notification', async () => { await deliverPending(); });
  registerHandler('delete_files', async (p) => {
    for (const rel of (p.paths as string[]) ?? []) await deleteUnreferencedPath(rel);
  });
  registerHandler('sweep', async () => {
    const now = nowIso();
    scheduleDeliveries();
    await cleanExpiredTransfers();
    await pruneCoverCache();
    db.delete(schema.downloadTokens).where(lt(schema.downloadTokens.expiresAt, now)).run();
    db.delete(schema.adminSessions).where(lt(schema.adminSessions.expiresAt, now)).run();
    // Tmp files older than a day are leftovers of aborted uploads.
    const tmp = storage.abs('tmp');
    for (const f of await fsp.readdir(tmp).catch(() => [] as string[])) {
      const st = await fsp.stat(path.join(tmp, f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 86_400_000) await fsp.rm(path.join(tmp, f), { recursive: true, force: true });
    }
    // Re-render anything stuck pending for more than 10 minutes with no queued job.
    for (const ph of db.select({ id: schema.photos.id }).from(schema.photos).where(and(eq(schema.photos.renditionStatus, 'pending'), lt(schema.photos.updatedAt, new Date(Date.now() - 600_000).toISOString()))).limit(50).all())
      enqueue('render_photo', { photoId: ph.id }, { dedupeKey: `render:${ph.id}` });
    enqueue('sweep', {}, { runAt: new Date(Date.now() + 3_600_000), dedupeKey: 'sweep' });
  });
  registerHandler('backup', async () => {
    const dir = storage.abs('backups');
    const stamp = new Date().toISOString().slice(0, 10);
    await sqlite.backup(path.join(dir, `app-${stamp}.sqlite`));
    const files = (await fsp.readdir(dir)).filter((f) => f.startsWith('app-') && f.endsWith('.sqlite')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 14))) await fsp.rm(path.join(dir, f), { force: true });
    const next = new Date(); next.setUTCHours(24 + 9, 0, 0, 0); // ~01:00-02:00 Pacific
    enqueue('backup', {}, { runAt: next, dedupeKey: 'backup' });
  });

  startJobRunner();
  scheduleDeliveries();
  // Recover an order committed before its caller managed to schedule delivery.
  setInterval(scheduleDeliveries, 60_000).unref();
  enqueue('sweep', {}, { dedupeKey: 'sweep' });
  enqueue('backup', {}, { runAt: new Date(Date.now() + 5 * 60_000), dedupeKey: 'backup' });
  if (!env.isProd) console.log(`[workers] data dir ${env.dataDir}`);
}

/** Never let a delayed deletion job remove a file re-referenced by a later upload. */
export async function deleteUnreferencedPath(rel: string): Promise<boolean> {
  return withStorageLock(rel, async () => {
  const absolute = storage.abs(rel);
  // Directory deletions are legacy/photo derivatives; immutable originals are per-object.
  const references = sqlite.prepare(`SELECT 1 FROM photo_files WHERE storage_path = ? OR substr(storage_path, 1, length(?) + 1) = ? || '/' LIMIT 1`).get(rel, rel, rel);
  if (references) return false;
  const sidecarReferences = sqlite.prepare(`SELECT 1 FROM photo_sidecars WHERE storage_path = ? OR substr(storage_path, 1, length(?) + 1) = ? || '/' LIMIT 1`).get(rel, rel, rel);
  if (sidecarReferences) return false;
  // A stale cleanup must not remove the currently published preview set.
  for (const photo of sqlite.prepare('SELECT p.id, p.rendition_hash hash, g.event_id eventId FROM photos p JOIN galleries g ON g.id=p.gallery_id').all() as { id: number; hash: string | null; eventId: number }[]) {
    const active = storage.derivative(photo.eventId, photo.id, 'thumb', photo.hash);
    if (active === rel || active.startsWith(rel + '/') || rel.startsWith(path.posix.dirname(active) + '/')) return false;
  }
  const hash = path.basename(rel).match(/^([a-f0-9]{64})\.[a-z0-9]+$/)?.[1];
  if (hash && sqlite.prepare('SELECT 1 FROM order_item_cells WHERE print_sha256 = ? LIMIT 1').get(hash)) return false;
  const objects = sqlite.prepare("SELECT storage_path path FROM storage_objects WHERE storage_path = ? OR substr(storage_path, 1, length(?) + 1) = ? || '/'").all(rel, rel, rel) as { path: string }[];
  for (const object of objects) await deleteObject(object.path);
  await fsp.rm(absolute, { recursive: true, force: true });
  return true;
  });
}
