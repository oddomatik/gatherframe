import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';

// Exercise the real ingest/storage/grouping services with disposable images and migrated SQLite.
// No application database, owner uploads, external storage, or background workers are accessed.
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    env: { dataDir: mkdtempSync(join(tmpdir(), 'picture-day-lightroom-')), secret: 'synthetic-lightroom-test', publicOrigin: 'https://fixture.invalid', maxUploadBytes: 1e7 },
    nowIso: () => new Date().toISOString()
  };
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
import { ingestUpload, type IngestResult, type UploadInput } from './ingest';
import { archiveCollection, createCollection, ensureIntake, organizePhotos } from './grouping';
import { listImportPhotos } from './import-photos';
import { shutdownImages } from './images';
import { storage } from './storage';

let eventId: number, intakeId: number;

function createEvent(slug: string) {
  return db.insert(schema.events).values({ slug, name: slug, variantPolicy: { social: 'free', print: 'free', raw: 'disabled' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get().id;
}

beforeEach(() => {
  for (const table of ['jobs', 'order_events', 'order_item_cells', 'order_item_sheets', 'order_items', 'payments', 'orders', 'photo_files', 'photos', 'galleries', 'events']) {
    sqlite.exec(`DELETE FROM ${table}`);
  }
  eventId = createEvent('lightroom-fixture');
  intakeId = ensureIntake(eventId);
});

afterAll(async () => {
  await shutdownImages();
  sqlite.close();
  await fs.rm(env.dataDir, { recursive: true, force: true });
});

function jpeg(color = '#f4cabb', width = 64) {
  return sharp({ create: { width, height: 48, channels: 3, background: color } }).jpeg().toBuffer();
}

function upload(filename: string, bytes: Buffer, extra: Partial<UploadInput> = {}) {
  return ingestUpload({
    eventId, galleryId: intakeId, filename, role: 'print',
    body: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
    declaredBytes: bytes.length, ...extra
  });
}

function memberships(photoId: number) {
  return (sqlite.prepare('SELECT gallery_id AS id FROM gallery_photos WHERE photo_id = ? ORDER BY gallery_id').all(photoId) as { id: number }[]).map((row) => row.id);
}

function files(photoId: number) {
  return db.select().from(schema.photoFiles).where(eq(schema.photoFiles.photoId, photoId)).all();
}

function sortIntoSharedCollections(photoId: number) {
  const child = createCollection(eventId, 'Striped shirt');
  const sibling = createCollection(eventId, 'Yellow jumper');
  organizePhotos({ eventId, photoIds: [photoId], sourceId: intakeId, targetId: child, mode: 'move' });
  organizePhotos({ eventId, photoIds: [photoId], targetId: sibling, mode: 'add' });
  return [child, sibling];
}

function orderCell(photo: IngestResult) {
  const order = db.insert(schema.orders).values({
    eventId, orderNumber: 'LIGHTROOM-ORDER', accessToken: 'synthetic-confirmation-link', idempotencyKey: 'synthetic-order-key',
    customerName: 'Test parent', status: 'new', subtotalCents: 1000, totalCents: 1000, currency: 'USD', createdAt: nowIso(), updatedAt: nowIso()
  }).returning().get();
  const item = db.insert(schema.orderItems).values({ orderId: order.id, productCode: 'TEST', productName: 'One print', productKind: 'package', quantity: 1, unitPriceCents: 1000, totalCents: 1000 }).returning().get();
  const sheet = db.insert(schema.orderItemSheets).values({ orderItemId: item.id, sheetIndex: 0, templateCode: 'TEST', label: 'One print', paperWidthIn: 8, paperHeightIn: 10 }).returning().get();
  return db.insert(schema.orderItemCells).values({
    orderItemSheetId: sheet.id, cellIndex: 0, printSizeCode: '4x6', label: '4 × 6', wIn: 4, hIn: 6, xIn: 0, yIn: 0,
    photoId: photo.photoId, photoStem: photo.stem, galleryName: 'Private photographer label', printSha256: photo.sha256
  }).returning().get();
}

// Reproduce persisted records from the former folder-hashed importer without invoking its removed
// naming logic. Files still go through real ingestion; only the legacy identity is installed here.
async function legacyPhoto(folder: string, bytes: Buffer, originalFilename = 'IMG_0412.jpg') {
  const result = await upload(`legacy-seed-${folder}.jpg`, bytes);
  db.update(schema.photos).set({ stem: `img_0412~folder-${folder}` }).where(eq(schema.photos.id, result.photoId)).run();
  db.update(schema.photoFiles).set({ originalFilename }).where(eq(schema.photoFiles.id, result.fileId)).run();
  return result;
}

describe('Lightroom import identity across versions, folders and collections', () => {
  it('sets a batch day only on new photos and preserves it through shared sorting, later roles and replacement', async () => {
    const first = await upload('day-test.jpg', await jpeg(), { shootDay: 1 });
    const collections = sortIntoSharedCollections(first.photoId);
    const order = orderCell(first);
    const getPhoto = () => db.select().from(schema.photos).where(eq(schema.photos.id, first.photoId)).get()!;
    expect(getPhoto().shootDay).toBe(1);
    const social = await upload('day-test.jpg', await jpeg('#ffbb11', 32), { role: 'social', shootDay: 2 });
    expect(social.photoId).toBe(first.photoId);
    const repeat = await upload('day-test.jpg', await jpeg(), { shootDay: 2 });
    expect(repeat.status).toBe('unchanged');
    await upload('day-test.jpg', await jpeg('#00bbcc'), { shootDay: 2, replacement: 'replace' });
    expect(getPhoto().shootDay).toBe(1);
    expect(memberships(first.photoId)).toEqual(collections);
    expect(db.select().from(schema.orderItemCells).where(eq(schema.orderItemCells.id, order.id)).get()).toEqual(order);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('keeps old or mixed-day photos unlabeled until the owner assigns them explicitly', async () => {
    const first = await upload('mixed-day.jpg', await jpeg());
    await upload('mixed-day.jpg', await jpeg('#ffbb11', 32), { role: 'social', shootDay: 2 });
    expect(db.select().from(schema.photos).where(eq(schema.photos.id, first.photoId)).get()!.shootDay).toBeNull();
    await expect(upload('invalid-day.jpg', await jpeg(), { shootDay: 3 as 1 })).rejects.toMatchObject({ status: 400 });
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('retains a sidecar-first day as RAW and JPEG arrive later', async () => {
    const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" /></x:xmpmeta>');
    const first = await upload('sidecar-day.xmp', xmp, { role: 'xmp', shootDay: 2 });
    const raw = await sharp(await jpeg()).tiff().toBuffer();
    const added = await upload('sidecar-day.dng', raw, { role: 'raw', shootDay: 1 });
    await upload('sidecar-day.jpg', await jpeg());
    expect(added.photoId).toBe(first.photoId);
    expect(db.select().from(schema.photos).where(eq(schema.photos.id, first.photoId)).get()!.shootDay).toBe(2);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('pairs unequal full/social exports by filename, never by upload position or directory contents', async () => {
    const first = await upload('full/IMG_0412.jpg', await jpeg('#ffbb11'));
    const second = await upload('full/IMG_0413.jpg', await jpeg('#11bbff'));
    const social = await upload('social/IMG_0413.jpeg', await jpeg('#11bbff', 32), { role: 'social' });
    expect(social.photoId).toBe(second.photoId);
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
    expect(files(first.photoId).map((f) => f.role)).toEqual(['print']);
    expect(files(second.photoId).map((f) => f.role).sort()).toEqual(['print', 'social']);
    expect(memberships(first.photoId)).toEqual([intakeId]);
  });

  it('adds a later variant after sorting without restoring intake or adding the selected unrelated collection', async () => {
    const original = await upload('IMG_0412.jpg', await jpeg());
    const shared = sortIntoSharedCollections(original.photoId);
    const unrelated = createCollection(eventId, 'Unrelated destination for new photos');
    const later = await upload('IMG_0412.jpeg', await jpeg('#f4cabb', 32), { role: 'social', galleryId: unrelated });
    expect(later.photoId).toBe(original.photoId);
    expect(memberships(original.photoId)).toEqual(shared);
    expect(db.select().from(schema.photos).get()).toMatchObject({ id: original.photoId, galleryId: intakeId });
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
    const newPhoto = await upload('IMG_0413.jpg', await jpeg('#1199aa'), { galleryId: unrelated });
    expect(memberships(newPhoto.photoId)).toEqual([unrelated]);
  });

  it('attaches a full-resolution file to a previously imported, already sorted social-only photo', async () => {
    const social = await upload('IMG_0412.jpeg', await jpeg('#aabbcc', 24), { role: 'social' });
    const shared = sortIntoSharedCollections(social.photoId);
    const full = await upload('IMG_0412.jpg', await jpeg('#aabbcc', 96));
    expect(full.photoId).toBe(social.photoId);
    expect(memberships(full.photoId)).toEqual(shared);
    expect(files(full.photoId).map((f) => f.role).sort()).toEqual(['print', 'social']);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('scopes identical camera filenames to an event even when the image bytes are identical', async () => {
    const bytes = await jpeg();
    const first = await upload('IMG_0412.jpg', bytes);
    const otherEvent = createEvent('other-shoot');
    const otherIntake = ensureIntake(otherEvent);
    const second = await upload('IMG_0412.jpg', bytes, { eventId: otherEvent, galleryId: otherIntake });
    expect(second.photoId).not.toBe(first.photoId);
    expect(files(second.photoId)[0].storagePath).not.toBe(files(first.photoId)[0].storagePath);
    expect(memberships(first.photoId)).toEqual([intakeId]);
    expect(memberships(second.photoId)).toEqual([otherIntake]);
  });

  it('treats an exact retry after sorting as unchanged without changing any collections', async () => {
    const bytes = await jpeg();
    const first = await upload('IMG_0412.jpg', bytes);
    const shared = sortIntoSharedCollections(first.photoId);
    const unrelated = createCollection(eventId, 'Do not add existing photos here');
    const before = files(first.photoId);
    const retry = await upload('IMG_0412.jpg', bytes, { galleryId: unrelated });
    expect(retry).toMatchObject({ status: 'unchanged', photoId: first.photoId, fileId: first.fileId, sha256: first.sha256 });
    expect(files(first.photoId)).toEqual(before);
    expect(memberships(first.photoId)).toEqual(shared);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('requires explicit replacement and preserves stable photo/order links and historical master bytes', async () => {
    const originalBytes = await jpeg('#883322');
    const original = await upload('IMG_0412.jpg', originalBytes);
    const originalFile = files(original.photoId)[0];
    const shared = sortIntoSharedCollections(original.photoId);
    const cell = orderCell(original);
    const changedBytes = await jpeg('#22bb99');
    await expect(upload('IMG_0412.jpg', changedBytes)).rejects.toMatchObject({ status: 409 });
    expect(files(original.photoId)[0]).toEqual(originalFile);
    expect(memberships(original.photoId)).toEqual(shared);
    const replaced = await upload('IMG_0412.jpg', changedBytes, { replacement: 'replace' });
    expect(replaced).toMatchObject({ status: 'replaced', photoId: original.photoId, fileId: original.fileId });
    expect(replaced.sha256).not.toBe(original.sha256);
    expect(memberships(original.photoId)).toEqual(shared);
    expect(db.select().from(schema.orderItemCells).where(eq(schema.orderItemCells.id, cell.id)).get()).toEqual(cell);
    expect(await fs.readFile(storage.abs(originalFile.storagePath))).toEqual(originalBytes);
    expect(await fs.readFile(storage.abs(files(original.photoId)[0].storagePath))).toEqual(changedBytes);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('finds legacy folder-hashed photos by original filename after they leave their storage-anchor collection', async () => {
    const legacy = await legacyPhoto('abc123', await jpeg());
    const shared = sortIntoSharedCollections(legacy.photoId);
    const social = await upload('IMG_0412.jpeg', await jpeg('#f4cabb', 24), { role: 'social' });
    expect(social.photoId).toBe(legacy.photoId);
    expect(social.stem).toBe('img_0412~folder-abc123');
    expect(memberships(social.photoId)).toEqual(shared);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
  });

  it('gives import review the same aliases and sorted/archived photo inventory used by ingestion', async () => {
    const legacy = await legacyPhoto('abc123', await jpeg());
    const shared = sortIntoSharedCollections(legacy.photoId);
    const separate = await upload('IMG_0412.jpg', await jpeg('#cc3355'), { stemOverride: 'owner-separate-copy' });
    const archived = createCollection(eventId, 'Old collection');
    const anchored = await upload('IMG_0450.jpg', await jpeg('#337799'), { galleryId: archived });
    organizePhotos({ eventId, photoIds: [anchored.photoId], sourceId: archived, targetId: shared[0], mode: 'move' });
    archiveCollection(eventId, archived);
    const otherEvent = createEvent('another-event');
    await upload('IMG_0412.jpg', await jpeg('#aacc44'), { eventId: otherEvent, galleryId: ensureIntake(otherEvent) });
    const inventory = listImportPhotos(eventId);
    expect(inventory).toHaveLength(3);
    const legacyRow = inventory.find((photo) => photo.id === legacy.photoId)!;
    expect(legacyRow.matchKeys).toEqual(['img_0412~folder-abc123', 'img_0412']);
    expect(legacyRow.collections.map((collection) => collection.id).sort((a, b) => a - b)).toEqual(shared);
    expect(legacyRow.files[0].originalFilename).toBe('IMG_0412.jpg');
    expect(inventory.find((photo) => photo.id === separate.photoId)!.matchKeys).toEqual(['owner-separate-copy']);
    expect(inventory.find((photo) => photo.id === anchored.photoId)).toMatchObject({ galleryId: archived, matchKeys: ['img_0450'] });
    const later = await upload('IMG_0450.jpeg', await jpeg('#337799', 24), { role: 'social' });
    expect(later.photoId).toBe(anchored.photoId);
    expect(memberships(later.photoId)).toEqual([shared[0]]);
  });

  it('rejects ambiguous legacy filenames across the event, even if one match is in the selected collection', async () => {
    const firstBytes = await jpeg('#aa3355');
    const first = await legacyPhoto('one', firstBytes);
    const second = await legacyPhoto('two', await jpeg('#33aa55'));
    const child = createCollection(eventId, 'First child');
    organizePhotos({ eventId, photoIds: [first.photoId], sourceId: intakeId, targetId: child, mode: 'move' });
    const before = db.select().from(schema.photoFiles).all();
    await expect(upload('IMG_0412.jpeg', await jpeg('#112233', 24), { role: 'social', galleryId: child })).rejects.toMatchObject({ status: 409 });
    expect(db.select().from(schema.photoFiles).all()).toEqual(before);
    expect(memberships(first.photoId)).toEqual([child]);
    expect(memberships(second.photoId)).toEqual([intakeId]);
    const exactRetry = await upload('IMG_0412.jpg', firstBytes);
    expect(exactRetry).toMatchObject({ status: 'unchanged', photoId: first.photoId });
    expect(memberships(first.photoId)).toEqual([child]);
  });

  it('does not guess between two legacy matches with identical current bytes', async () => {
    const bytes = await jpeg();
    await legacyPhoto('one', bytes);
    await legacyPhoto('two', bytes);
    await expect(upload('IMG_0412.jpg', bytes)).rejects.toMatchObject({ status: 409 });
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
    expect(db.select().from(schema.photoFiles).all()).toHaveLength(2);
  });

  it('keeps explicitly separated photos separate and makes their own retries stable after sorting', async () => {
    const bytes = await jpeg('#aabbcc');
    const original = await upload('IMG_0412.jpg', bytes);
    const separateBytes = await jpeg('#cc55aa');
    const stemOverride = 'img_0412-separate-2';
    const separate = await upload('IMG_0412.jpg', separateBytes, { stemOverride });
    expect(separate.photoId).not.toBe(original.photoId);
    const shared = sortIntoSharedCollections(separate.photoId);
    const retry = await upload('IMG_0412.jpg', separateBytes, { stemOverride });
    expect(retry).toMatchObject({ status: 'unchanged', photoId: separate.photoId });
    const separateSocial = await upload('IMG_0412.jpeg', await jpeg('#cc55aa', 24), { stemOverride, role: 'social' });
    expect(separateSocial.photoId).toBe(separate.photoId);
    const originalSocial = await upload('IMG_0412.jpeg', await jpeg('#aabbcc', 24), { role: 'social' });
    expect(originalSocial.photoId).toBe(original.photoId);
    expect(memberships(separate.photoId)).toEqual(shared);
    expect(files(original.photoId).map((f) => f.role).sort()).toEqual(['print', 'social']);
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
  });

  it('does not give an old Keep-separate key an alias merely because it contains a folder hash', async () => {
    const original = await legacyPhoto('abc123', await jpeg());
    const stemOverride = 'img_0412~folder-abc123~old-keep-separate-uuid';
    const separateBytes = await jpeg('#cc5588');
    const separate = await upload('IMG_0412.jpg', separateBytes, { stemOverride });
    const inventory = listImportPhotos(eventId);
    expect(inventory.find((photo) => photo.id === original.photoId)!.matchKeys).toContain('img_0412');
    expect(inventory.find((photo) => photo.id === separate.photoId)!.matchKeys).toEqual([stemOverride]);
    const social = await upload('IMG_0412.jpeg', await jpeg('#f4cabb', 24), { role: 'social' });
    expect(social.photoId).toBe(original.photoId);
    expect((await upload('IMG_0412.jpg', separateBytes, { stemOverride })).photoId).toBe(separate.photoId);
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
  });

  it('preserves absent photos and optional versions when a later export contains only a subset', async () => {
    const firstBytes = await jpeg('#884433');
    const first = await upload('IMG_0412.jpg', firstBytes);
    await upload('IMG_0412.jpeg', await jpeg('#884433', 24), { role: 'social' });
    const second = await upload('IMG_0413.jpg', await jpeg('#1133bb'));
    const secondFiles = files(second.photoId);
    const social = files(first.photoId).find((f) => f.role === 'social')!;
    expect((await upload('IMG_0412.jpg', firstBytes)).status).toBe('unchanged');
    expect(files(second.photoId)).toEqual(secondFiles);
    expect(files(first.photoId).find((f) => f.role === 'social')).toEqual(social);
    for (const file of [social, ...secondFiles]) expect((await fs.stat(storage.abs(file.storagePath))).size).toBe(file.bytes);
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
  });

  it('matches extension/case/Unicode differences but does not strip meaningful filename endings', async () => {
    const original = await upload('Jose\u0301_IMG_0412.JPG', await jpeg());
    const social = await upload('JOSÉ_IMG_0412.jpeg', await jpeg('#f4cabb', 24), { role: 'social' });
    expect(social.photoId).toBe(original.photoId);
    const alternate = await upload('José_IMG_0412-2.jpg', await jpeg('#3322bb'));
    const edited = await upload('José_IMG_0412-Edit.jpg', await jpeg('#bb3322'));
    expect(new Set([original.photoId, alternate.photoId, edited.photoId]).size).toBe(3);
  });

  it('pairs concurrent full/social uploads into one stable photo', async () => {
    const fullBytes = await jpeg();
    const socialBytes = await jpeg('#f4cabb', 24);
    const [full, social] = await Promise.all([
      upload('IMG_0412.jpg', fullBytes),
      upload('IMG_0412.jpeg', socialBytes, { role: 'social' })
    ]);
    expect(full.photoId).toBe(social.photoId);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
    expect(files(full.photoId)).toHaveLength(2);
    expect(memberships(full.photoId)).toEqual([intakeId]);
  });
});
