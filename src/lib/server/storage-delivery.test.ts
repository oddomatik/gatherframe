import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

// Real migrated database, access capabilities and HTTP handlers; only the remote store is fake.
vi.mock('./env', () => ({ env: { dataDir: '/tmp/picture-day-no-delivery-files', secret: 'synthetic-delivery-capability-secret', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
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

import { db, schema, sqlite } from './db';
import { nowIso } from './env';
import { objectStat, openObject } from './blob-store';
import { grantEventAccess } from './access';
import { mediaUrl } from './media-access';
import { GET as fileGET, HEAD as fileHEAD } from '../../routes/g/[slug]/file/[fileId]/+server';
import { GET as mediaGET, HEAD as mediaHEAD } from '../../routes/media/[photoId]/[kind]/+server';

const bytes = Buffer.from('0123456789-full-resolution-photo');
const sha256 = createHash('sha256').update(bytes).digest('hex');
let event: typeof schema.events.$inferSelect, photoId: number, fileId: number, cookies: Cookies;
beforeEach(() => {
  vi.resetAllMocks();
  for (const table of ['download_log', 'photo_files', 'photos', 'galleries', 'events']) sqlite.exec(`DELETE FROM ${table}`);
  event = db.insert(schema.events).values({ slug: 'fixture', name: 'Fixture', passwordHash: 'synthetic-password-fingerprint', isPublished: 1, variantPolicy: { print: 'free' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get();
  const gallery = db.insert(schema.galleries).values({ eventId: event.id, publicId: 'fixture-gallery', name: 'Private child label', createdAt: nowIso() }).returning().get();
  photoId = db.insert(schema.photos).values({ galleryId: gallery.id, stem: 'IMG_0042', displayName: 'IMG_0042', renditionStatus: 'ready', createdAt: nowIso(), updatedAt: nowIso() }).returning().get().id;
  db.insert(schema.galleryPhotos).values({ galleryId: gallery.id, photoId }).run();
  fileId = db.insert(schema.photoFiles).values({ photoId, role: 'print', originalFilename: 'IMG_0042.jpg', ext: 'jpg', mime: 'image/jpeg', bytes: bytes.length, sha256, storagePath: 'originals/remote-only.jpg', createdAt: nowIso() }).returning().get().id;
  const values = new Map<string, string>([['pk_sid', 'synthetic-visitor-12345']]);
  cookies = {
    get: (name) => values.get(name), set: (name, value) => { values.set(name, value); }, delete: (name) => { values.delete(name); },
    getAll: () => [...values].map(([name, value]) => ({ name, value })), serialize: (name, value) => `${name}=${value}`
  };
  grantEventAccess(event, values.get('pk_sid')!, cookies, true);
  vi.mocked(objectStat).mockResolvedValue({ size: bytes.length, sha256 });
  vi.mocked(openObject).mockImplementation(async (_path, range) => Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]));
});
afterAll(() => sqlite.close());

function request(path: string, method = 'GET', headers: Record<string, string> = {}, signal?: AbortSignal): RequestEvent {
  const url = new URL(path, 'https://fixture.invalid');
  return { url, params: { slug: event.slug, fileId: String(fileId), photoId: String(photoId), kind: 'preview' }, request: new Request(url, { method, headers, signal }), cookies, locals: {}, getClientAddress: () => '127.0.0.1' } as RequestEvent;
}
const downloadPath = () => `/g/fixture/file/${fileId}`;

describe('private remote photo delivery', () => {
  it('keeps event authorization and scoped media capabilities ahead of any storage reads', async () => {
    cookies.delete(`pk_g_${event.id}`, { path: '/' });
    await expect(fileGET(request(downloadPath()))).rejects.toMatchObject({ status: 401 });
    await expect(mediaGET(request(`/media/${photoId}/preview`))).rejects.toMatchObject({ status: 403 });
    const wrongKind = request(mediaUrl(event, photoId, 'thumb'));
    await expect(mediaGET(wrongKind)).rejects.toMatchObject({ status: 403 });
    expect(objectStat).not.toHaveBeenCalled();
    expect(openObject).not.toHaveBeenCalled();
  });

  it('supports HEAD, suffix ranges and If-Range through private remote objects', async () => {
    const head = await fileHEAD(request(downloadPath(), 'HEAD', { range: 'bytes=-5' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    expect(openObject).not.toHaveBeenCalled();
    expect(db.select().from(schema.downloadLog).all()).toHaveLength(0);

    const partial = await fileGET(request(downloadPath(), 'GET', { range: 'bytes=-5', 'if-range': `"${sha256}"` }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(-5));
    expect(openObject).toHaveBeenLastCalledWith('originals/remote-only.jpg', { start: bytes.length - 5, end: bytes.length - 1 });

    const invalid = await fileGET(request(downloadPath(), 'GET', { range: `bytes=${bytes.length}-` }));
    expect(invalid.status).toBe(416);
    expect(openObject).toHaveBeenCalledTimes(1);

    const replaced = await fileGET(request(downloadPath(), 'GET', { range: 'bytes=-5', 'if-range': '"previous-master"' }));
    expect(replaced.status).toBe(200);
    expect(Buffer.from(await replaced.arrayBuffer())).toEqual(bytes);
    expect(replaced.headers.get('cache-control')).toBe('private, no-store');
    expect(replaced.headers.get('location')).toBeNull();
    expect(db.select().from(schema.downloadLog).all()).toHaveLength(2);
  });

  it('fails closed on missing, mismatched, or unreachable remote originals without recording a download', async () => {
    vi.mocked(objectStat).mockRejectedValueOnce(new Error('synthetic provider failure'));
    await expect(fileGET(request(downloadPath()))).rejects.toMatchObject({ status: 404 });
    vi.mocked(objectStat).mockResolvedValueOnce({ size: bytes.length, sha256: 'wrong-master' });
    await expect(fileGET(request(downloadPath()))).rejects.toMatchObject({ status: 404 });
    expect(openObject).not.toHaveBeenCalled();
    vi.mocked(openObject).mockRejectedValueOnce(new Error('synthetic remote body failure'));
    await expect(fileGET(request(downloadPath()))).rejects.toMatchObject({ status: 404 });
    expect(db.select().from(schema.downloadLog).all()).toHaveLength(0);
  });

  it('serves previews through scoped app URLs and never opens remote bodies for HEAD', async () => {
    const path = mediaUrl(event, photoId, 'preview');
    const head = await mediaHEAD(request(path, 'HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/webp');
    expect(openObject).not.toHaveBeenCalled();
    const preview = await mediaGET(request(path));
    expect(preview.headers.get('content-disposition')).toBe(`inline; filename="preview-only-${photoId}.webp"`);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    expect(preview.headers.get('location')).toBeNull();
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    expect(openObject).toHaveBeenCalledWith(`derivatives/${event.id}/${photoId}/preview.webp`);
    vi.mocked(objectStat).mockRejectedValueOnce(new Error('preview missing'));
    await expect(mediaGET(request(path))).rejects.toMatchObject({ status: 404 });
  });

  it('destroys an opened remote response when a download is aborted', async () => {
    const source = new Readable({ read() {} });
    vi.mocked(openObject).mockResolvedValue(source);
    const controller = new AbortController();
    await fileGET(request(downloadPath(), 'GET', {}, controller.signal));
    controller.abort();
    expect(source.destroyed).toBe(true);
  });

  it('privately caches current owner renditions, validates stale URLs and avoids remote reads on 304', async () => {
    const version = `v2-${sha256}-first`;
    sqlite.prepare('UPDATE photos SET rendition_hash=? WHERE id=?').run(version, photoId);
    const owner = (path: string, headers: Record<string,string> = {}) => {
      const e = request(path, 'GET', headers); e.locals.admin = { id: 1, email: 'owner@example.invalid' }; return e;
    };
    const path = `/media/${photoId}/preview?v=${version}`;
    const response = await mediaGET(owner(path)); await response.arrayBuffer();
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600, immutable');
    expect(response.headers.get('vary')).toBe('Cookie');
    const etag = response.headers.get('etag')!;
    vi.mocked(objectStat).mockClear(); vi.mocked(openObject).mockClear();
    const cached = await mediaGET(owner(path, { 'if-none-match': `"other", W/${etag}` }));
    expect(cached.status).toBe(304); expect(await cached.text()).toBe('');
    expect(objectStat).not.toHaveBeenCalled(); expect(openObject).not.toHaveBeenCalled();
    const stale = await mediaGET(owner(`/media/${photoId}/preview?v=old`)); await stale.arrayBuffer();
    expect(stale.headers.get('cache-control')).toBe('private, no-cache');
    sqlite.prepare('UPDATE photos SET rendition_hash=? WHERE id=?').run(`v2-${sha256}-second`, photoId);
    const changed = await mediaGET(owner(path, { 'if-none-match': etag })); await changed.arrayBuffer();
    expect(changed.status).toBe(200); expect(changed.headers.get('etag')).not.toBe(etag);
    expect(changed.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('rechecks parent capabilities before conditional cache responses and never shares owner caching', async () => {
    const version = `v2-${sha256}-parent`;
    sqlite.prepare('UPDATE photos SET rendition_hash=? WHERE id=?').run(version, photoId);
    const path = mediaUrl(event, photoId, 'preview', version);
    const response = await mediaGET(request(path)); await response.arrayBuffer();
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    const etag = response.headers.get('etag')!;
    vi.mocked(objectStat).mockClear(); vi.mocked(openObject).mockClear();
    expect((await mediaGET(request(path, 'GET', {'if-none-match':etag}))).status).toBe(304);
    expect(objectStat).not.toHaveBeenCalled(); expect(openObject).not.toHaveBeenCalled();
    await expect(mediaGET(request(`/media/${photoId}/preview?v=${version}`, 'GET', {'if-none-match':etag}))).rejects.toMatchObject({status:403});
    sqlite.prepare('UPDATE events SET is_published=0 WHERE id=?').run(event.id);
    await expect(mediaGET(request(path, 'GET', {'if-none-match':etag}))).rejects.toMatchObject({status:403});
    const previewOwner=request(`/media/${photoId}/preview?v=${version}`, 'GET', {'if-none-match':etag});
    previewOwner.locals.admin={id:1,email:'owner@example.invalid'};cookies.set('pk_parent_preview','1',{path:'/'});
    await expect(mediaGET(previewOwner)).rejects.toMatchObject({status:403});
    expect(openObject).not.toHaveBeenCalled();
  });

  it('keeps signed image URLs stable during rerenders without extending access past 24 hours', () => {
    const hour = Math.floor(Date.now()/3600000)*3600000;
    const clock=vi.spyOn(Date,'now');
    try {
      clock.mockReturnValue(hour+1000); const first=mediaUrl(event,photoId,'thumb','version');
      clock.mockReturnValue(hour+2000); expect(mediaUrl(event,photoId,'thumb','version')).toBe(first);
      const claim=JSON.parse(Buffer.from(new URL(first,'https://fixture.invalid').searchParams.get('t')!.split('.')[0],'base64url').toString());
      expect(claim.exp).toBeLessThanOrEqual(Date.now()+24*3600000);
      clock.mockReturnValue(hour+3600000);expect(mediaUrl(event,photoId,'thumb','version')).not.toBe(first);
    } finally { clock.mockRestore(); }
  });
});
