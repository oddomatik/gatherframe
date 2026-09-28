import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: { secret: 'isolated-shoot-day-test', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
import { db, schema, sqlite } from './db';
import { createEvent, listEventPhotos, listPhotos } from './events';
import { createCollection, ensureIntake, organizePhotos } from './grouping';
import { setPhotoShootDay } from './shoot-days';
import { actions } from '../../routes/admin/events/[id]/+page.server';

let eventId: number;
const timestamp = '2026-09-24T10:00:00.000Z';
function addPhoto(galleryId: number, name: string, takenAt: string | null = null) {
  const photo = db.insert(schema.photos).values({ galleryId, stem: name, displayName: `${name}.jpg`, takenAt,
    renditionStatus: 'ready', renditionHash: 'stable-preview-hash', renderSourceRole: 'print', createdAt: timestamp, updatedAt: timestamp }).returning().get();
  db.insert(schema.galleryPhotos).values({ galleryId, photoId: photo.id }).run();
  db.insert(schema.photoFiles).values({ photoId: photo.id, role: 'print', originalFilename: `${name}.jpg`, ext: 'jpg', mime: 'image/jpeg',
    bytes: 1234, sha256: 'original-file-hash', storagePath: `fixtures/${photo.id}/original.jpg`, createdAt: timestamp }).run();
  return photo.id;
}
function photoRows() { return sqlite.prepare('SELECT * FROM photos ORDER BY id').all() as Record<string, unknown>[]; }
function relatedRows() {
  return Object.fromEntries(['gallery_photos', 'photo_files', 'order_item_cells', 'orders'].map((name) => [name, sqlite.prepare(`SELECT * FROM ${name}`).all()]));
}
function orderPhoto(photoId: number, galleryId: number) {
  const order = db.insert(schema.orders).values({ orderNumber: 'TEST-ONE', accessToken: 'owner-test-token', idempotencyKey: 'test-one',
    eventId, galleryId, customerName: 'Synthetic Parent', subtotalCents: 500, totalCents: 500, currency: 'USD', createdAt: timestamp, updatedAt: timestamp }).returning().get();
  const item = db.insert(schema.orderItems).values({ orderId: order.id, productCode: 'single', productName: 'One print', productKind: 'print',
    quantity: 1, unitPriceCents: 500, totalCents: 500 }).returning().get();
  const sheet = db.insert(schema.orderItemSheets).values({ orderItemId: item.id, sheetIndex: 0, templateCode: 'single', label: 'One print',
    paperWidthIn: 8, paperHeightIn: 10 }).returning().get();
  db.insert(schema.orderItemCells).values({ orderItemSheetId: sheet.id, cellIndex: 0, printSizeCode: '8x10', label: '8×10', wIn: 8, hIn: 10,
    xIn: 0, yIn: 0, photoId, photoStem: 'a-child', galleryId, galleryName: 'One child', printSha256: 'original-file-hash' }).run();
}
beforeEach(() => {
  for (const name of ['order_item_cells', 'order_item_sheets', 'order_items', 'orders', 'photos', 'galleries', 'events']) sqlite.exec(`DELETE FROM ${name}`);
  eventId = createEvent({ name: 'A two-day picture party' }).id;
});
afterAll(() => sqlite.close());

describe('photographer shoot-day assignment', () => {
  it('labels one child across both days and shares the moment’s day everywhere without changing existing references', () => {
    const intake = ensureIntake(eventId), child = createCollection(eventId, 'One child'), friend = createCollection(eventId, 'Friend');
    const first = addPhoto(intake, 'a-child', '2026-09-24T10:00:00Z');
    const later = addPhoto(intake, 'a-child-again', '2026-09-25T10:00:00Z');
    organizePhotos({ eventId, photoIds: [first, later], targetId: child, mode: 'add' });
    organizePhotos({ eventId, photoIds: [later], targetId: friend, mode: 'add' });
    orderPhoto(first, child);
    const photosBefore = photoRows(), relatedBefore = relatedRows();
    expect(setPhotoShootDay(eventId, [first], 1)).toEqual({ count: 1, day: 1 });
    expect(setPhotoShootDay(eventId, [later, later], '2')).toEqual({ count: 1, day: 2 });
    expect(listPhotos(child).map((p) => [p.id, p.shootDay])).toEqual([[first, 1], [later, 2]]);
    expect(listPhotos(friend).map((p) => [p.id, p.shootDay])).toEqual([[later, 2]]);
    expect(relatedRows()).toEqual(relatedBefore);
    expect(photoRows().map(({ shoot_day: _day, ...rest }) => rest)).toEqual(photosBefore.map(({ shoot_day: _day, ...rest }) => rest));
  });

  it('defaults existing and undated photos to unlabeled and can clear a label without touching capture dates', () => {
    const photoId = addPhoto(ensureIntake(eventId), 'no-camera-date');
    expect(listEventPhotos(eventId)[0].shootDay).toBeNull();
    setPhotoShootDay(eventId, [photoId], 2);
    expect(setPhotoShootDay(eventId, [photoId], null)).toEqual({ count: 1, day: null });
    expect(listEventPhotos(eventId)[0]).toMatchObject({ shootDay: null, takenAt: null });
  });

  it('rejects cross-event and stale batches atomically rather than changing the valid subset', () => {
    const here = addPhoto(ensureIntake(eventId), 'here');
    const otherEvent = createEvent({ name: 'Unrelated event' }).id;
    const elsewhere = addPhoto(ensureIntake(otherEvent), 'elsewhere');
    setPhotoShootDay(eventId, [here], 1);
    const before = photoRows();
    expect(() => setPhotoShootDay(eventId, [here, elsewhere], 2)).toThrow('Nothing was changed');
    expect(photoRows()).toEqual(before);
    expect(() => setPhotoShootDay(eventId, [here, 999999], null)).toThrow('Nothing was changed');
    expect(photoRows()).toEqual(before);
  });

  it('rolls back the entire batch if an update fails after validation', () => {
    const intake = ensureIntake(eventId), first = addPhoto(intake, 'first'), second = addPhoto(intake, 'second');
    sqlite.exec(`CREATE TEMP TRIGGER fail_second_day BEFORE UPDATE OF shoot_day ON photos WHEN NEW.id = ${second}
      BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;`);
    try {
      expect(() => setPhotoShootDay(eventId, [first, second], 1)).toThrow('synthetic write failure');
      expect(listEventPhotos(eventId).map((p) => p.shootDay)).toEqual([null, null]);
    } finally { sqlite.exec('DROP TRIGGER fail_second_day'); }
  });

  it('refuses invalid day values and invalid selections without mutations', () => {
    const photoId = addPhoto(ensureIntake(eventId), 'unchanged'), before = photoRows();
    for (const day of ['yesterday', 0, 3, '1.5', {}, true]) expect(() => setPhotoShootDay(eventId, [photoId], day)).toThrow();
    for (const ids of [[], [0], [-1], [NaN], [1.5], [Infinity]]) expect(() => setPhotoShootDay(eventId, ids, 1)).toThrow();
    expect(() => setPhotoShootDay(eventId, Array.from({ length: 5001 }, (_, i) => i + 1), 1)).toThrow('5,000');
    expect(photoRows()).toEqual(before);
  });

  it('requires a signed-in owner at the form action and labels only explicit submitted selections', async () => {
    const photoId = addPhoto(ensureIntake(eventId), 'selected');
    const untouched = addPhoto(ensureIntake(eventId), 'not-selected');
    const form = new FormData(); form.append('photoId', String(photoId)); form.set('shootDay', '2');
    const request = () => new Request('https://fixture.invalid/admin/events/1?/setShootDay', { method: 'POST', body: form });
    const call = actions.setShootDay as Function;
    await expect(call({ params: { id: String(eventId) }, locals: {}, request: request() })).rejects.toMatchObject({ status: 401 });
    expect(listEventPhotos(eventId).map((p) => p.shootDay)).toEqual([null, null]);
    const response = await call({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request() });
    expect(response.ok).toContain('1 photo labeled Day 2');
    expect(listEventPhotos(eventId).map((p) => [p.id, p.shootDay])).toEqual([[untouched, null], [photoId, 2]]);
    form.delete('shootDay');
    expect((await call({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request() })).status).toBe(400);
    expect(listEventPhotos(eventId).find(p => p.id === photoId)?.shootDay).toBe(2);
    form.set('shootDay', '');
    expect((await call({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request() })).ok).toContain('returned to Not labeled');
    expect(listEventPhotos(eventId).find(p => p.id === photoId)?.shootDay).toBeNull();
  });
});
