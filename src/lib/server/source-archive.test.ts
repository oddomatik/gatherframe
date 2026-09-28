import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('./env', () => ({ env: { dataDir: '/tmp/picture-day-archive-test', secret: 'synthetic-archive-secret', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
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
vi.mock('./blob-store', () => ({ objectStat: vi.fn(), openObject: vi.fn() }));
vi.mock('./workers', () => ({ startWorkers: vi.fn() }));

import { db, schema, sqlite } from './db';
import { objectStat, openObject } from './blob-store';
import { sourceArchiveEntries } from './source-archive';
import { listEventPhotos } from './events';
import { handle } from '../../hooks.server';
import { GET } from '../../routes/admin/api/photos/[id]/source-archive/+server';
import { load as adminLoad } from '../../routes/admin/events/[id]/+page.server';

const rawBytes = Buffer.from([0, 4, 255, 8, 20, 10]);
const xmpBytes = Buffer.from('<?xml version="1.0"?><xmp>private-keyword</xmp>');
const acrBytes = Buffer.from([0, 8, 255, 6, 12]);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const metadata = { rating: 4, label: 'Blue', keywords: ['Private child label'], title: 'Private title', description: 'Private caption' };
const objects = new Map([['originals/raw', rawBytes], ['sidecars/xmp', xmpBytes], ['sidecars/acr', acrBytes]]);
let photoId: number, eventId: number;

beforeEach(() => {
  vi.resetAllMocks();
  sqlite.exec('DELETE FROM events; DELETE FROM settings;');
  const now = new Date().toISOString();
  const event = db.insert(schema.events).values({ slug: 'archive-fixture', name: 'Fixture', variantPolicy: { print: 'free', raw: 'free' }, createdAt: now, updatedAt: now }).returning().get();
  eventId = event.id;
  const gallery = db.insert(schema.galleries).values({ eventId, publicId: 'fixture-gallery', name: 'Collection 1', createdAt: now }).returning().get();
  photoId = db.insert(schema.photos).values({ galleryId: gallery.id, stem: 'img_0042', displayName: 'IMG_0042', createdAt: now, updatedAt: now }).returning().get().id;
  db.insert(schema.galleryPhotos).values({ photoId, galleryId: gallery.id }).run();
  db.insert(schema.photoFiles).values({ photoId, role: 'raw', originalFilename: 'IMG_0042.CR3', ext: 'cr3', mime: 'application/octet-stream', storagePath: 'originals/raw', bytes: rawBytes.length, sha256: digest(rawBytes), createdAt: now }).run();
  for (const kind of ['xmp', 'acr'] as const) {
    const bytes = objects.get(`sidecars/${kind}`)!;
    db.insert(schema.photoSidecars).values({ photoId, kind, originalFilename: `img_0042.${kind}`, ext: kind, mime: 'application/octet-stream', storagePath: `sidecars/${kind}`, bytes: bytes.length, sha256: digest(bytes), metadata, createdAt: now, updatedAt: now }).run();
  }
  vi.mocked(objectStat).mockImplementation(async (key) => { const bytes = objects.get(key); if (!bytes) throw new Error('missing'); return { size: bytes.length, sha256: digest(bytes) }; });
  vi.mocked(openObject).mockImplementation(async (key) => { const bytes = objects.get(key); if (!bytes) throw new Error('missing'); return Readable.from([bytes]); });
});
afterAll(() => sqlite.close());

function request(admin = true, signal?: AbortSignal): RequestEvent {
  const url = new URL(`/admin/api/photos/${photoId}/source-archive`, 'https://fixture.invalid');
  return { url, params: { id: String(photoId) }, request: new Request(url, { signal }),
    cookies: { get: () => 'parent-gallery-grant', delete: vi.fn() },
    locals: { admin: admin ? { id: 1, email: 'owner@fixture.invalid' } : null, requestId: 'fixture' }, setHeaders: vi.fn()
  } as unknown as RequestEvent;
}

/** Parse stored ZIP records from the central directory to assert exact file bytes,
 * rather than merely finding a string somewhere in a compressed archive. */
function unzipStored(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let pos = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let count = 0; count < zip.readUInt16LE(end + 10); count++) {
    expect(zip.readUInt32LE(pos)).toBe(0x02014b50);
    expect(zip.readUInt16LE(pos + 10)).toBe(0);
    const size = zip.readUInt32LE(pos + 20), nameLength = zip.readUInt16LE(pos + 28), extraLength = zip.readUInt16LE(pos + 30), commentLength = zip.readUInt16LE(pos + 32), local = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString();
    const offset = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.set(name, zip.subarray(offset, offset + size));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('private editing archive', () => {
  it('rejects parent/anonymous requests both in the handler and before routing', async () => {
    await expect(GET(request(false))).rejects.toMatchObject({ status: 401 });
    const resolve = vi.fn();
    const response = await handle({ event: request(false), resolve } as unknown as Parameters<typeof handle>[0]);
    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
    expect(objectStat).not.toHaveBeenCalled();
    expect(openObject).not.toHaveBeenCalled();
  });

  it('downloads byte-exact RAW, XMP and ACR with a matching original basename through the storage adapter', async () => {
    const response = await GET(request());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('IMG_0042-RAW-and-sidecars.zip');
    const files = unzipStored(Buffer.from(await response.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(['IMG_0042.acr', 'IMG_0042.cr3', 'IMG_0042.xmp']);
    expect(files.get('IMG_0042.cr3')).toEqual(rawBytes);
    expect(files.get('IMG_0042.xmp')).toEqual(xmpBytes);
    expect(files.get('IMG_0042.acr')).toEqual(acrBytes);
    expect(openObject).toHaveBeenCalledTimes(3);
  });

  it('preflights every companion and refuses missing/changed data or an oversized bundle', async () => {
    vi.mocked(objectStat).mockResolvedValueOnce({ size: rawBytes.length, sha256: 'wrong' });
    await expect(GET(request())).rejects.toMatchObject({ status: 409 });
    expect(openObject).not.toHaveBeenCalled();
    db.insert(schema.settings).values({ key: 'zipStreamMaxBytes', value: { v: 1 }, updatedAt: new Date().toISOString() }).run();
    await expect(GET(request())).rejects.toMatchObject({ status: 413 });
    expect(openObject).not.toHaveBeenCalled();
    sqlite.exec('DELETE FROM settings; DELETE FROM photo_files;');
    await expect(GET(request())).rejects.toMatchObject({ status: 409 });
  });

  it('keeps sidecar metadata confined to the authenticated admin page', async () => {
    const anonymous = request(false); anonymous.params.id = String(eventId);
    await expect(Promise.resolve().then(() => adminLoad(anonymous as unknown as Parameters<typeof adminLoad>[0]))).rejects.toMatchObject({ status: 401 });
    const owner = request(); owner.params.id = String(eventId);
    const loaded = await adminLoad(owner as unknown as Parameters<typeof adminLoad>[0]);
    expect(owner.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
    expect(loaded?.photos[0].sidecars[0].metadata.keywords).toEqual(metadata.keywords);
    expect(JSON.stringify(loaded?.photos)).not.toContain('sidecars/xmp');
    const sharedPhotos = listEventPhotos(eventId);
    expect(JSON.stringify(sharedPhotos)).not.toContain('Private child label');
    expect(sharedPhotos[0]).not.toHaveProperty('sidecars');
  });

  it('terminates the remote RAW response when the caller cancels', async () => {
    const source = new Readable({ read() {} });
    vi.mocked(openObject).mockResolvedValue(source);
    const controller = new AbortController();
    const response = await GET(request(true, controller.signal));
    const consumed = response.arrayBuffer();
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(consumed).rejects.toThrow('Download cancelled');
    expect(source.destroyed).toBe(true);
  });

  it('sanitizes unsafe source names consistently for every companion', () => {
    const common = { originalFilename: '../../CON.CR3', ext: 'cr3', storagePath: 'fixture', bytes: 0, sha256: 'synthetic' };
    const bundle = sourceArchiveEntries(common, [{ ...common, originalFilename: 'OTHER.xmp', kind: 'xmp' }]);
    expect(bundle.entries.map((entry) => entry.name)).toEqual(['photo-CON.cr3', 'photo-CON.xmp']);
    expect(sourceArchiveEntries({ ...common, originalFilename: 'folder\\José:?\u0001.CR3' }, []).entries[0].name).toBe('José___.cr3');
  });
});
