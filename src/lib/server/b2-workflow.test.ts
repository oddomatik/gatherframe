import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';

const cloud = vi.hoisted(() => ({ objects: new Map<string, { bytes: Buffer; hash: string }>(), sequence: 0, corrupt: false, headHook: null as null | (() => void) }));
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return { ...actual, S3Client: class {
    destroy() {}
    async send(command: { constructor: { name: string }; input: Record<string, any> }) {
      const i = command.input, key = `${i.Bucket}/${i.Key}@${i.VersionId}`;
      switch (command.constructor.name) {
        case 'GetBucketAclCommand': return { Grants: [{ Grantee: { Type: 'CanonicalUser' } }] };
        case 'PutObjectCommand': {
          const parts = []; for await (const part of Buffer.isBuffer(i.Body) ? [i.Body] : i.Body) parts.push(Buffer.from(part));
          const VersionId = String(++cloud.sequence);
          cloud.objects.set(`${i.Bucket}/${i.Key}@${VersionId}`, { bytes: Buffer.concat(parts), hash: i.Metadata.sha256 });
          return { VersionId };
        }
        case 'DeleteObjectCommand': cloud.objects.delete(key); return {};
        default: {
          const object = cloud.objects.get(key); if (!object) throw Object.assign(new Error('missing synthetic object'), { name: 'NoSuchKey' });
          if (command.constructor.name === 'HeadObjectCommand') { cloud.headHook?.(); return { ContentLength: object.bytes.length, Metadata: { sha256: object.hash } }; }
          const bytes = cloud.corrupt ? Buffer.alloc(object.bytes.length, 0) : object.bytes;
          return { Body: Readable.from([bytes]), ContentLength: bytes.length };
        }
      }
    }
  } };
});
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  return { env: { dataDir: mkdtempSync(join(tmpdir(), 'picture-day-b2-workflow-')), secret: 'synthetic-not-live-b2-test', maxUploadBytes: 1e7, publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3'); const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema'); const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { storage } from './storage';
import { ingestUpload, deletePhotoFile } from './ingest';
import { renderPhoto, shutdownImages } from './images';
import { openObject, testStorageConnection, setStorageMode, storageStatus } from './blob-store';
import { printReadiness } from './production';
import { deleteUnreferencedPath } from './workers';

let eventId: number, galleryId: number;
beforeEach(async () => {
  for (const [key, value] of Object.entries({ B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_REGION: 'us-west-004', B2_BUCKET: 'synthetic-photos', B2_KEY_ID: 'synthetic-id', B2_APPLICATION_KEY: 'synthetic-secret', B2_PREFIX: 'test', STORAGE_SKIP_SPACE_CHECK: '1' })) vi.stubEnv(key, value);
  cloud.objects.clear(); cloud.corrupt = false; cloud.headHook = null;
  for (const table of ['storage_objects', 'settings', 'jobs', 'order_events', 'order_item_cells', 'order_item_sheets', 'order_items', 'payments', 'orders', 'photo_files', 'photos', 'galleries', 'events']) sqlite.exec(`DELETE FROM ${table}`);
  await fs.rm(env.dataDir, { recursive: true, force: true }); await fs.mkdir(storage.abs('tmp'), { recursive: true });
  eventId = db.insert(schema.events).values({ slug: 'b2-test', name: 'B2 fixture', variantPolicy: { social: 'free', print: 'free', raw: 'disabled' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get().id;
  galleryId = db.insert(schema.galleries).values({ eventId, publicId: 'intake', name: 'To sort', createdAt: nowIso() }).returning().get().id;
  await testStorageConnection(); await setStorageMode('b2');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await shutdownImages(); sqlite.close(); await fs.rm(env.dataDir, { recursive: true, force: true }); });
async function jpeg(color = '#abcdef') { return sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer(); }
async function upload(bytes: Buffer, extra: Partial<Parameters<typeof ingestUpload>[0]> = {}) {
  return ingestUpload({ eventId, galleryId, filename: 'IMG_0042.jpg', role: 'print', body: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>, declaredBytes: bytes.length, ...extra });
}
async function contents(rel: string) { const chunks = []; for await (const c of await openObject(rel)) chunks.push(c); return Buffer.concat(chunks); }
function detail(photoId: number, sha: string): Parameters<typeof printReadiness>[0] { return { items: [{ sheets: [{ cells: [{ id: 123, photoId, photoStem: 'img_0042', printSha256: sha }] }] }] } as Parameters<typeof printReadiness>[0]; }

describe('actual ingestion and rendering through simulated B2', () => {
  it('keeps private XMP bytes and metadata linked in B2, survives mode changes, and protects live companions from cleanup', async () => {
    const original = await upload(await jpeg());
    await renderPhoto(original.photoId);
    const before = db.select().from(schema.photos).get()!;
    const xmp = Buffer.from(`<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="4"><dc:subject><rdf:Bag><rdf:li>Private keyword</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`);
    const companion = await upload(xmp, { filename: 'RAW/IMG_0042.xmp', role: 'raw' });
    expect(companion.photoId).toBe(original.photoId);
    const sidecar = db.select().from(schema.photoSidecars).get()!;
    expect(sidecar.metadata).toMatchObject({ rating: 4, keywords: ['Private keyword'] });
    expect(await contents(sidecar.storagePath)).toEqual(xmp);
    await expect(fs.stat(storage.abs(sidecar.storagePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await deleteUnreferencedPath(sidecar.storagePath)).toBe(false);
    expect(db.select().from(schema.photos).get()).toMatchObject({ renditionHash: before.renditionHash, renditionStatus: 'ready' });
    expect(db.select().from(schema.photoFiles).all().map((f) => f.role)).toEqual(['print']);
    await setStorageMode('local');
    expect(await contents(sidecar.storagePath)).toEqual(xmp);
    expect((await upload(xmp, { filename: 'IMG_0042.xmp', role: 'raw' })).status).toBe('unchanged');
    expect(await fs.readFile(storage.abs(sidecar.storagePath))).toEqual(xmp);
  });
  it('pairs later Lightroom exports without changing shared collections, renders remotely, and reads after switching local', async () => {
    const small = await upload(await jpeg(), { role: 'social' });
    const child = db.insert(schema.galleries).values({ eventId, publicId: 'child', name: 'Child', createdAt: nowIso() }).returning().get();
    const friend = db.insert(schema.galleries).values({ eventId, publicId: 'friend', name: 'Friend', createdAt: nowIso() }).returning().get();
    db.insert(schema.galleryPhotos).values([{ galleryId: child.id, photoId: small.photoId }, { galleryId: friend.id, photoId: small.photoId }]).run();
    db.delete(schema.galleryPhotos).where(eq(schema.galleryPhotos.galleryId, galleryId)).run();
    const bytes = await jpeg('#11cc22'), full = await upload(bytes);
    expect(full.photoId).toBe(small.photoId);
    expect(db.select().from(schema.galleryPhotos).all()).toHaveLength(2);
    const file = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.id, full.fileId)).get()!;
    await expect(fs.stat(storage.abs(file.storagePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await contents(file.storagePath)).toEqual(bytes);
    await renderPhoto(full.photoId);
    const photo = db.select().from(schema.photos).get()!;
    expect(photo.renditionStatus).toBe('ready');
    for (const kind of ['thumb', 'preview', 'web'] as const) {
      const rel = storage.derivative(eventId, photo.id, kind, photo.renditionHash);
      expect((await sharp(await contents(rel)).metadata()).format).toBe('webp');
      await expect(fs.stat(storage.abs(rel))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect((await printReadiness(detail(photo.id, full.sha256))).ready).toBe(true);
    expect(await fs.readdir(storage.abs('tmp'))).toEqual([]);
    await setStorageMode('local');
    vi.stubEnv('B2_BUCKET', 'different-target');
    expect(await contents(file.storagePath)).toEqual(bytes);
    expect((await upload(bytes)).status).toBe('unchanged');
    expect(await fs.readFile(storage.abs(file.storagePath))).toEqual(bytes);
    expect((await storageStatus()).counts).toEqual({ local: 1, remote: 5 });
    expect(db.select().from(schema.storageObjects).where(eq(schema.storageObjects.storagePath, file.storagePath)).get()!.remoteBucket).toBe('synthetic-photos');
  });
  it('does not publish a photo after failed remote byte verification', async () => {
    cloud.corrupt = true;
    await expect(upload(await jpeg())).rejects.toThrow('checksum');
    expect(db.select().from(schema.photos).all()).toHaveLength(0);
    expect(db.select().from(schema.photoFiles).all()).toHaveLength(0);
    expect(db.select().from(schema.storageObjects).all()).toHaveLength(0);
    expect(await fs.readdir(storage.abs('tmp'))).toEqual([]);
  });
  it('holds missing cloud masters and keeps the last complete previews after a failed new render', async () => {
    const original = await upload(await jpeg()); await renderPhoto(original.photoId);
    const before = db.select().from(schema.photos).get()!;
    const next = await upload(await jpeg('#cc2211'), { replacement: 'replace' });
    cloud.corrupt = true;
    await expect(renderPhoto(next.photoId)).rejects.toThrow('checksum');
    expect(db.select().from(schema.photos).get()).toMatchObject({ renditionHash: before.renditionHash, renditionStatus: 'failed' });
    cloud.objects.clear(); cloud.corrupt = false;
    expect((await printReadiness(detail(next.photoId, next.sha256))).conflicts[0].reason).toBe('missing_file');
    expect(await fs.readdir(storage.abs('tmp'))).toEqual([]);
  });
  it('fences a cloud production check if its master is replaced during HEAD', async () => {
    const original = await upload(await jpeg());
    cloud.headHook = () => db.update(schema.photoFiles).set({ sha256: 'f'.repeat(64) }).where(eq(schema.photoFiles.id, original.fileId)).run();
    const check = await printReadiness(detail(original.photoId, original.sha256));
    expect(check.ready).toBe(false);
    expect(check.conflicts[0].reason).toBe('changed_print');
  });
  it('retains live cloud objects during cleanup and deletes an unreferenced exact version', async () => {
    const original = await upload(await jpeg()); await renderPhoto(original.photoId);
    const file = db.select().from(schema.photoFiles).get()!, photo = db.select().from(schema.photos).get()!;
    expect(await deleteUnreferencedPath(file.storagePath)).toBe(false);
    expect(await deleteUnreferencedPath(storage.derivativeDir(eventId, photo.id))).toBe(false);
    const count = cloud.objects.size;
    await deletePhotoFile(original.fileId);
    expect(await deleteUnreferencedPath(file.storagePath)).toBe(true);
    expect(cloud.objects.size).toBe(count - 1);
    expect(db.select().from(schema.storageObjects).where(eq(schema.storageObjects.storagePath, file.storagePath)).get()).toBeUndefined();
  });
});
