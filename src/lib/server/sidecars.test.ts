import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { exiftool } from 'exiftool-vendored';

vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { env: { dataDir: mkdtempSync(join(tmpdir(), 'picture-day-sidecars-')), secret: 'synthetic-sidecars', publicOrigin: 'https://fixture.invalid', maxUploadBytes: 32 * 1024 * 1024 }, nowIso: () => new Date().toISOString() };
});
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

import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { ingestUpload, deletePhoto, deletePhotoFile, type UploadInput } from './ingest';
import { createCollection, ensureIntake, organizePhotos } from './grouping';
import { listImportPhotos } from './import-photos';
import { listEventPhotos } from './events';
import { shutdownImages } from './images';
import { storage } from './storage';
import { deleteUnreferencedPath } from './workers';
import { MAX_XMP_BYTES } from './sidecars';
import { VARIANT_ROLES, inferUploadRole } from '$shared/stem';

let eventId: number, intakeId: number;
beforeEach(() => {
  sqlite.exec('DELETE FROM jobs; DELETE FROM photos; DELETE FROM galleries; DELETE FROM events; DELETE FROM storage_objects;');
  eventId = db.insert(schema.events).values({ slug: 'sidecar-fixture', name: 'Sidecar fixture', variantPolicy: { social: 'free', print: 'free', raw: 'free' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get().id;
  intakeId = ensureIntake(eventId);
});
afterAll(async () => {
  await shutdownImages();
  sqlite.close();
  await fs.rm(env.dataDir, { recursive: true, force: true });
});

const xml = (body = '', attrs = 'xmp:Rating="4" xmp:Label="Blue"') => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""
 xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
 xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${attrs}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`);
const jpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer();
const raw = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#aabbcc' } }).tiff().toBuffer();
function upload(filename: string, bytes: Buffer, extra: Partial<UploadInput> = {}) {
  return ingestUpload({ eventId, galleryId: intakeId, filename, role: 'raw', body: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>, declaredBytes: bytes.length, ...extra });
}
function sidecar(photoId: number, kind = 'xmp') {
  return db.select().from(schema.photoSidecars).where(eq(schema.photoSidecars.photoId, photoId)).all().find((row) => row.kind === kind)!;
}

describe('private Lightroom companions', () => {
  it('pairs sidecar-first, RAW and finished JPEG into one stable photo without rendering metadata', async () => {
    const first = await upload('IMG_0412.XMP', xml());
    expect(first.role).toBe('xmp');
    expect(db.select().from(schema.photoFiles).all()).toHaveLength(0);
    expect(db.select().from(schema.jobs).all()).toHaveLength(0);
    expect(db.select().from(schema.photos).get()).toMatchObject({ renditionStatus: 'nosource', width: null, height: null });
    const source = await upload('IMG_0412.dng', await raw());
    const print = await upload('IMG_0412.jpg', await jpeg(), { role: 'print' });
    expect(source.photoId).toBe(first.photoId);
    expect(print.photoId).toBe(first.photoId);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
    expect(db.select().from(schema.photoFiles).all().map((f) => f.role).sort()).toEqual(['print', 'raw']);
    expect(sidecar(first.photoId)).toMatchObject({ originalFilename: 'IMG_0412.XMP', kind: 'xmp', metadata: { rating: 4, label: 'Blue' }, metadataWarning: null });
    expect(listImportPhotos(eventId)[0].sidecars[0].sha256).toBe(first.sha256);
  });

  it('attaches RAW companions after sorting without changing shared memberships, dimensions or ready previews', async () => {
    const image = await upload('IMG_0412.dng', await raw());
    const child = createCollection(eventId, 'Child A'), friend = createCollection(eventId, 'Child B');
    organizePhotos({ eventId, photoIds: [image.photoId], sourceId: intakeId, targetId: child, mode: 'move' });
    organizePhotos({ eventId, photoIds: [image.photoId], targetId: friend, mode: 'add' });
    db.update(schema.photos).set({ width: 4000, height: 3000, renditionStatus: 'ready', renditionHash: 'old-render-hash', renderSourceRole: 'print' }).where(eq(schema.photos.id, image.photoId)).run();
    sqlite.exec('DELETE FROM jobs');
    const before = db.select().from(schema.photos).get();
    const xmp = await upload('IMG_0412.xmp', xml());
    const acr = await upload('IMG_0412.acr', Buffer.from('opaque Adobe companion'));
    expect(xmp.photoId).toBe(image.photoId); expect(acr.photoId).toBe(image.photoId);
    expect(db.select().from(schema.photos).get()).toEqual(before);
    expect(db.select().from(schema.jobs).all()).toHaveLength(0);
    expect(db.select().from(schema.galleryPhotos).all().map((g) => g.galleryId).sort()).toEqual([child, friend].sort());
    expect(await fs.readFile(storage.abs(sidecar(image.photoId, 'acr').storagePath))).toEqual(Buffer.from('opaque Adobe companion'));
  });

  it('preserves unchanged uploads, requires replacement choice, and keeps previous bytes immutable', async () => {
    const original = xml(), revised = xml('', 'xmp:Rating="5"');
    const first = await upload('IMG_0412.xmp', original);
    const before = sidecar(first.photoId);
    expect((await upload('IMG_0412.xmp', original)).status).toBe('unchanged');
    expect(sidecar(first.photoId)).toEqual(before);
    await expect(upload('IMG_0412.xmp', revised)).rejects.toMatchObject({ status: 409 });
    expect(sidecar(first.photoId)).toEqual(before);
    expect(await upload('IMG_0412.xmp', revised, { replacement: 'replace' })).toMatchObject({ status: 'replaced', photoId: first.photoId, fileId: first.fileId });
    expect(sidecar(first.photoId).metadata.rating).toBe(5);
    expect(await fs.readFile(storage.abs(before.storagePath))).toEqual(original);
    expect(db.select().from(schema.jobs).all()).toHaveLength(0);
  });

  it('indexes descriptive metadata only, with bounded values and no parent-gallery exposure', async () => {
    const xmp = xml(`<dc:subject><rdf:Bag><rdf:li>Child A</rdf:li><rdf:li>Friends &amp; fun</rdf:li><rdf:li>Child A</rdf:li></rdf:Bag></dc:subject>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Private title</rdf:li></rdf:Alt></dc:title>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${'a'.repeat(3000)}</rdf:li></rdf:Alt></dc:description>
<exif:GPSLatitude>47.5</exif:GPSLatitude><crs:Exposure2012>1.5</crs:Exposure2012>`);
    const photo = await upload('IMG_0412.jpg', await jpeg(), { role: 'print' });
    await upload('IMG_0412.xmp', xmp);
    const { metadata } = sidecar(photo.photoId);
    expect(metadata).toMatchObject({ rating: 4, label: 'Blue', title: 'Private title', keywords: ['Child A', 'Friends & fun'] });
    expect(metadata.description).toHaveLength(2000);
    expect(Object.keys(metadata).sort()).toEqual(['description', 'keywords', 'label', 'rating', 'title']);
    expect(JSON.stringify(listEventPhotos(eventId))).not.toMatch(/Private title|Child A|Friends & fun|47\.5/);
    expect(VARIANT_ROLES).toEqual(['social', 'print', 'raw']);
    expect(inferUploadRole({ filename: 'IMG_0412.xmp', zoneRole: 'print' })).toBe('xmp');
    expect(db.select().from(schema.photoFiles).all()).toHaveLength(1);
  });

  it.each([
    Buffer.from('<!DOCTYPE x [<!ENTITY external SYSTEM "file:///etc/passwd">]><rdf:RDF>&external;</rdf:RDF>'),
    Buffer.from('<!DOCTYPE x SYSTEM "https://example.invalid/remote.dtd"><rdf:RDF/>'),
    Buffer.from('<rdf:RDF>&external;</rdf:RDF>'),
    Buffer.from('<?xml-stylesheet href="https://example.invalid/xsl"?><rdf:RDF/>'),
    Buffer.from('<?xml version="1.0"?><rdf:RDF/>', 'utf16le')
  ])('archives unsafe XML without invoking an external parser or indexing it', async (bytes) => {
    const parser = vi.spyOn(exiftool, 'readRaw');
    try {
      const saved = await upload('unsafe.xmp', bytes);
      expect(parser).not.toHaveBeenCalled();
      const row = sidecar(saved.photoId);
      expect(row.metadataWarning).toContain('archived without indexing');
      expect(row.metadata.keywords).toEqual([]);
      expect(await fs.readFile(storage.abs(row.storagePath))).toEqual(bytes);
    } finally { parser.mockRestore(); }
  });

  it('archives malformed XMP with a useful warning', async () => {
    const saved = await upload('broken.xmp', Buffer.from('<rdf:RDF><broken>'));
    expect(sidecar(saved.photoId).metadataWarning).toContain('archived without indexing');
    expect(sidecar(saved.photoId).metadata.rating).toBeNull();
  });

  it('enforces the XMP bound for declared and streamed sizes before storing a photo', async () => {
    await expect(upload('large.xmp', Buffer.from('small'), { declaredBytes: MAX_XMP_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
    await expect(upload('large.xmp', Buffer.alloc(MAX_XMP_BYTES + 1, 32), { declaredBytes: null })).rejects.toMatchObject({ status: 413 });
    expect(db.select().from(schema.photos).all()).toHaveLength(0);
    expect(db.select().from(schema.photoSidecars).all()).toHaveLength(0);
  });

  it('keeps same names event-scoped and pairs concurrent image/sidecar uploads', async () => {
    const [companion, image] = await Promise.all([upload('IMG_0412.xmp', xml()), upload('IMG_0412.jpg', await jpeg(), { role: 'print' })]);
    expect(companion.photoId).toBe(image.photoId);
    const another = db.insert(schema.events).values({ slug: 'another-event', name: 'Another', variantPolicy: { social: 'free', print: 'free', raw: 'disabled' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get();
    const other = await upload('IMG_0412.xmp', xml(), { eventId: another.id, galleryId: ensureIntake(another.id) });
    expect(other.photoId).not.toBe(companion.photoId);
  });

  it('retains editing companions when removing the last image, and garbage collection respects live references', async () => {
    const first = await upload('IMG_0412.jpg', await jpeg(), { role: 'print' });
    await upload('IMG_0412.xmp', xml());
    const stored = sidecar(first.photoId);
    await deletePhotoFile(first.fileId);
    expect(db.select().from(schema.photos).get()).toMatchObject({ id: first.photoId, renditionStatus: 'nosource' });
    expect(sidecar(first.photoId)).toEqual(stored);
    expect(await deleteUnreferencedPath(stored.storagePath)).toBe(false);
    const restored = await upload('IMG_0412.jpg', await jpeg(), { role: 'print' });
    expect(restored.photoId).toBe(first.photoId);
    await deletePhoto(first.photoId);
    expect(db.select().from(schema.photoSidecars).all()).toHaveLength(0);
    const deletions = db.select().from(schema.jobs).all().filter((job) => job.type === 'delete_files');
    expect(JSON.stringify(deletions)).toContain(stored.storagePath);
    expect(await deleteUnreferencedPath(stored.storagePath)).toBe(true);
  });
});
