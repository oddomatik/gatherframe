import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: { dataDir: '/tmp/picture-day-no-production-files', secret: 'synthetic-production-test-secret' }, nowIso: () => '2026-09-25T00:00:00.000Z' }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
vi.mock('./blob-store', () => ({ objectStat: vi.fn() }));

import { db, schema, sqlite } from './db';
import { nowIso } from './env';
import { objectStat } from './blob-store';
import { createPrintInspection, printReadiness } from './production';

type Master = typeof schema.photoFiles.$inferSelect;
let masters: Master[];
beforeEach(() => {
  vi.resetAllMocks();
  for (const table of ['photo_files', 'photos', 'galleries', 'events']) sqlite.exec(`DELETE FROM ${table}`);
  const event = db.insert(schema.events).values({ slug: 'production-fixture', name: 'Fixture', variantPolicy: { print: 'free' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get();
  const gallery = db.insert(schema.galleries).values({ eventId: event.id, publicId: 'fixture-gallery', name: 'Collection', createdAt: nowIso() }).returning().get();
  masters = Array.from({ length: 9 }, (_, n) => {
    const photo = db.insert(schema.photos).values({ galleryId: gallery.id, stem: `IMG_${n}`, displayName: `IMG_${n}`, renditionStatus: 'ready', createdAt: nowIso(), updatedAt: nowIso() }).returning().get();
    return db.insert(schema.photoFiles).values({ photoId: photo.id, role: 'print', originalFilename: `IMG_${n}.jpg`, ext: 'jpg', mime: 'image/jpeg', bytes: 100 + n, sha256: String(n).repeat(64), storagePath: `originals/remote-${n}.jpg`, createdAt: nowIso() }).returning().get();
  });
});
afterAll(() => sqlite.close());

function detail(files: Master[]): Parameters<typeof printReadiness>[0] {
  // Only the master/approval cells are relevant; no production orders or files are changed.
  return { items: [{ sheets: [{ cells: files.map((f, n) => ({ id: n + 1, photoId: f.photoId, photoStem: f.originalFilename, printSha256: f.sha256 })) }] }] } as Parameters<typeof printReadiness>[0];
}
const advance = () => new Promise<void>((resolve) => setImmediate(resolve));
function controlledHeads() {
  let active = 0, peak = 0;
  const pending: { resolve: () => void; reject: (code: string) => void }[] = [];
  vi.mocked(objectStat).mockImplementation((key) => {
    const file = masters.find((f) => f.storagePath === key)!;
    active++; peak = Math.max(peak, active);
    return new Promise((resolve, reject) => pending.push({
      resolve: () => { active--; resolve({ size: file.bytes, sha256: file.sha256 }); },
      reject: (code) => { active--; reject(Object.assign(new Error('Synthetic storage failure'), { code })); }
    }));
  });
  return { pending, active: () => active, peak: () => peak };
}

describe('bounded shared production storage inspection', () => {
  it('shares duplicate checks across orders while allowing at most four remote HEADs', async () => {
    const heads = controlledHeads();
    const inspect = createPrintInspection();
    const result = Promise.all([
      printReadiness(detail(masters), inspect),
      printReadiness(detail([masters[0], masters[0], masters[2]]), inspect)
    ]);
    expect(objectStat).toHaveBeenCalledTimes(4);
    expect(heads.active()).toBe(4);
    heads.pending.shift()!.resolve();
    await advance();
    expect(objectStat).toHaveBeenCalledTimes(5);
    expect(heads.active()).toBe(4);
    heads.pending.splice(0).forEach((head) => head.resolve());
    await advance();
    expect(objectStat).toHaveBeenCalledTimes(9);
    heads.pending.splice(0).forEach((head) => head.resolve());
    const outcomes = await result;
    expect(outcomes.every((outcome) => outcome.ready && !outcome.conflicts.length)).toBe(true);
    expect(heads.peak()).toBe(4);
    expect(heads.active()).toBe(0);
    expect(vi.mocked(objectStat).mock.calls.filter(([key]) => key === masters[0].storagePath)).toHaveLength(1);
  });

  it('short-circuits queued checks after a provider outage but permits a fresh request to recover', async () => {
    const heads = controlledHeads();
    const inspect = createPrintInspection();
    const result = printReadiness(detail(masters), inspect);
    expect(objectStat).toHaveBeenCalledTimes(4);
    heads.pending.shift()!.reject('remote_unavailable');
    await advance();
    expect(objectStat).toHaveBeenCalledTimes(4);
    heads.pending.splice(0).forEach((head) => head.resolve());
    const outcome = await result;
    expect(outcome.ready).toBe(false);
    expect(outcome.conflicts.map((c) => c.photoId)).toEqual([masters[0], ...masters.slice(4)].map((f) => f.photoId));
    expect(outcome.conflicts.every((c) => c.reason === 'missing_file')).toBe(true);
    expect(await inspect(masters[8])).toBe(false);
    expect(objectStat).toHaveBeenCalledTimes(4);

    vi.mocked(objectStat).mockResolvedValueOnce({ size: masters[8].bytes, sha256: masters[8].sha256 });
    expect(await createPrintInspection()(masters[8])).toBe(true);
    expect(objectStat).toHaveBeenCalledTimes(5);
  });

  it('holds only a missing master and continues inspecting unrelated photos', async () => {
    vi.mocked(objectStat).mockImplementation(async (key) => {
      const file = masters.find((f) => f.storagePath === key)!;
      if (file.id === masters[0].id) throw Object.assign(new Error('Synthetic object missing'), { code: 'missing' });
      return { size: file.bytes, sha256: file.sha256 };
    });
    const inspect = createPrintInspection();
    const [missing, unaffected] = await Promise.all([
      printReadiness(detail(masters), inspect),
      printReadiness(detail(masters.slice(1)), inspect)
    ]);
    expect(missing.ready).toBe(false);
    expect(missing.conflicts).toMatchObject([{ photoId: masters[0].photoId, reason: 'missing_file' }]);
    expect(unaffected.ready).toBe(true);
    expect(unaffected.conflicts).toEqual([]);
    expect(objectStat).toHaveBeenCalledTimes(9);
  });
});
