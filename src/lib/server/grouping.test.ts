import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
vi.mock('./env', () => ({ env: { secret: 'isolated-grouping-test', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
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
import { addPhotosToCollections, archiveCollection, createCollection, ensureIntake, mergeCollections, organizePhotos } from './grouping';
import { createEvent, deleteGallery, listEventPhotos, listGalleries, listPhotos, setGalleryCover } from './events';
import { createPrintPackage, duplicateProduct, eventCatalog, loadCatalog, seedCatalog, setEventProduct, updateProduct } from './catalog';
import { load as catalogLoad } from '../../routes/admin/catalog/+page.server';
import { actions as eventActions } from '../../routes/admin/events/[id]/+page.server';
import { publicGalleries, publicPhotos } from './public';
import { saveOrganization } from './organizing';
import { POST as saveOrganizationRoute } from '../../routes/admin/api/events/[id]/organize/+server';

let eventId: number;
function addPhoto(galleryId: number, stem = 'same-camera-name', takenAt = '2026-09-24T08:00:00Z') {
  const p = db.insert(schema.photos).values({ galleryId, stem, displayName: `${stem}.jpg`, takenAt, renditionStatus: 'ready', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).returning().get();
  db.insert(schema.galleryPhotos).values({ galleryId, photoId: p.id }).run(); return p.id;
}
function members(photoId: number) { return (sqlite.prepare('SELECT gallery_id AS id FROM gallery_photos WHERE photo_id = ? ORDER BY gallery_id').all(photoId) as { id: number }[]).map((g) => g.id); }
beforeEach(() => {
  for (const table of ['jobs','photo_files','photos','galleries','event_products','events','product_sheets','products','sheet_template_cells','sheet_templates','print_sizes','catalogs']) sqlite.exec(`DELETE FROM ${table}`);
  eventId = createEvent({ name: 'All the happy chaos' }).id;
});
afterAll(() => sqlite.close());

describe('flexible photo collections on real migrated SQLite', () => {
  it('files a mixed solo/shared batch atomically and retries new collections without duplication', () => {
    const intake = ensureIntake(eventId), max = createCollection(eventId, 'Max');
    const solo = addPhoto(intake, 'solo'), shared = addPhoto(intake, 'shared'), remaining = addPhoto(intake, 'remaining');
    const photos = sqlite.prepare('SELECT * FROM photos ORDER BY id').all();
    const plan = { targets: [
      { kind: 'existing', galleryId: max, photoIds: [solo, shared] },
      { kind: 'new', key: 'stable-batch-key-123', label: 'Kid 001', photoIds: [shared] }
    ] };
    expect(saveOrganization(eventId, plan)).toEqual({ photos: 2, collections: 2 });
    const kid = listGalleries(eventId).find(g => g.name === 'Kid 001')!.id;
    expect(members(solo)).toEqual([max]); expect(members(shared)).toEqual([max, kid]); expect(members(remaining)).toEqual([intake]);
    saveOrganization(eventId, plan);
    expect(listGalleries(eventId).filter(g => g.name === 'Kid 001')).toHaveLength(1);
    expect(members(shared)).toEqual([max, kid]);
    expect(sqlite.prepare('SELECT * FROM photos ORDER BY id').all()).toEqual(photos);
  });

  it('rolls back all new collections and memberships when any target is stale or any write fails', () => {
    const intake = ensureIntake(eventId), photo = addPhoto(intake), good = createCollection(eventId);
    const other = createEvent({ name: 'Other event' }).id, foreign = createCollection(other), gone = createCollection(eventId);
    archiveCollection(eventId, gone);
    const before = sqlite.prepare('SELECT * FROM galleries ORDER BY id').all();
    const first = { kind: 'new', key: 'must-rollback-new-key', label: 'New child', photoIds: [photo] };
    for (const galleryId of [foreign, gone, intake, 99999]) {
      expect(() => saveOrganization(eventId, { targets: [first, { kind: 'existing', galleryId, photoIds: [photo] }] })).toThrow();
      expect(sqlite.prepare('SELECT * FROM galleries ORDER BY id').all()).toEqual(before);
      expect(members(photo)).toEqual([intake]);
    }
    sqlite.exec(`CREATE TEMP TRIGGER fail_batch BEFORE INSERT ON gallery_photos WHEN NEW.gallery_id=${good} BEGIN SELECT RAISE(ABORT, 'interrupted batch'); END;`);
    try { expect(() => saveOrganization(eventId, { targets: [first, { kind: 'existing', galleryId: good, photoIds: [photo] }] })).toThrow('interrupted batch'); }
    finally { sqlite.exec('DROP TRIGGER fail_batch'); }
    expect(sqlite.prepare('SELECT * FROM galleries ORDER BY id').all()).toEqual(before);
    expect(members(photo)).toEqual([intake]);
  });

  it('authenticates and validates focused sorting requests before modifying anything', async () => {
    const intake = ensureIntake(eventId), photo = addPhoto(intake), a = createCollection(eventId);
    const plan = { targets: [{ kind: 'existing', galleryId: a, photoIds: [photo] }] };
    const request = (body: string) => new Request('https://fixture.invalid', { method: 'POST', body });
    const route = saveOrganizationRoute as Function;
    await expect(route({ params: { id: String(eventId) }, locals: {}, request: request(JSON.stringify(plan)) })).rejects.toMatchObject({ status: 401 });
    for (const body of ['broken json', '{}', JSON.stringify({ targets: [plan.targets[0], plan.targets[0]] })])
      await expect(route({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request(body) })).rejects.toMatchObject({ status: 400 });
    expect(members(photo)).toEqual([intake]);
    const response = await route({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request(JSON.stringify(plan)) });
    expect(await response.json()).toEqual({ photos: 1, collections: 1 }); expect(members(photo)).toEqual([a]);
  });

  it('uses shot-number order after out-of-order arrivals, sharing and day filtering while respecting chosen covers', () => {
    const intake = ensureIntake(eventId), first = createCollection(eventId, 'Kid 001'), second = createCollection(eventId, 'Kid 002');
    const ten = addPhoto(intake, 'MtnKidsPicDay-10'), two = addPhoto(intake, 'MtnKidsPicDay-2'), nine = addPhoto(intake, 'MtnKidsPicDay-009');
    sqlite.prepare('UPDATE photos SET shoot_day = 2 WHERE id IN (?, ?)').run(ten, nine);
    addPhotosToCollections(eventId, [ten, two, nine], [first, second]);
    const event = db.select().from(schema.events).get()!;
    expect(listEventPhotos(eventId).map(p => p.id)).toEqual([two, nine, ten]);
    expect(listPhotos(first).map(p => p.id)).toEqual([two, nine, ten]);
    expect(publicPhotos(listPhotos(second), event.variantPolicy, event).map(p => p.id)).toEqual([two, nine, ten]);
    expect(listGalleries(eventId).find(g => g.id === first)?.coverThumbId).toBe(two);
    expect(publicGalleries(listGalleries(eventId), event, 2).find(g => g.id === first)?.coverThumbId).toBe(nine);
    setGalleryCover(first, ten);
    expect(listGalleries(eventId).find(g => g.id === first)?.coverThumbId).toBe(ten);
    expect(publicGalleries(listGalleries(eventId), event, 2).find(g => g.id === first)?.coverThumbId).toBe(ten);
    expect(JSON.stringify(publicPhotos(listPhotos(first), event.variantPolicy, event))).not.toContain('MtnKidsPicDay');
  });

  it('adds many photos to many collections once, preserving previous child memberships and originals', () => {
    const intake = ensureIntake(eventId), a = createCollection(eventId, 'Kid 001'), b = createCollection(eventId, 'Kid 002'), c = createCollection(eventId, 'Friends');
    const first = addPhoto(intake, 'shot-2'), second = addPhoto(c, 'shot-10');
    const originals = sqlite.prepare('SELECT * FROM photos ORDER BY id').all();
    expect(addPhotosToCollections(eventId, [first, second, first], [a, b, b])).toEqual({ count: 2, collections: 2 });
    expect(members(first)).toEqual([a, b]); expect(members(second)).toEqual([a, b, c]);
    addPhotosToCollections(eventId, [first, second], [a, b]);
    expect(members(second)).toEqual([a, b, c]);
    expect(sqlite.prepare('SELECT * FROM photos ORDER BY id').all()).toEqual(originals);
  });

  it('rejects stale/foreign destinations and photos and rolls back partial additions', () => {
    const intake = ensureIntake(eventId), a = createCollection(eventId), b = createCollection(eventId);
    const first = addPhoto(intake), otherEvent = createEvent({ name: 'Other' }).id, foreign = createCollection(otherEvent), foreignPhoto = addPhoto(foreign);
    for (const ids of [[a, foreign], [a, 99999], [a, intake], [], [NaN]]) expect(() => addPhotosToCollections(eventId, [first], ids)).toThrow();
    expect(() => addPhotosToCollections(eventId, [first, foreignPhoto], [a, b])).toThrow('Nothing was changed');
    archiveCollection(eventId, b); expect(() => addPhotosToCollections(eventId, [first], [a, b])).toThrow(); archiveCollection(eventId, b, true);
    sqlite.exec(`CREATE TEMP TRIGGER fail_add BEFORE INSERT ON gallery_photos WHEN NEW.gallery_id = ${b} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    try { expect(() => addPhotosToCollections(eventId, [first], [a, b])).toThrow('synthetic failure'); }
    finally { sqlite.exec('DROP TRIGGER fail_add'); }
    expect(members(first)).toEqual([intake]);
  });

  it('authenticates the multi-collection action and applies only the explicit photo/destination pairs', async () => {
    const intake = ensureIntake(eventId), a = createCollection(eventId), b = createCollection(eventId), first = addPhoto(intake), untouched = addPhoto(intake, 'untouched');
    const form = new FormData(); form.append('photoId', String(first)); for (const id of [a, b]) form.append('targetId', String(id));
    const request = () => new Request('https://fixture.invalid', { method: 'POST', body: form });
    const action = eventActions.addToCollections as Function;
    await expect(action({ params: { id: String(eventId) }, locals: {}, request: request() })).rejects.toMatchObject({ status: 401 });
    expect(members(first)).toEqual([intake]);
    expect(await action({ params: { id: String(eventId) }, locals: { admin: { id: 1 } }, request: request() })).toMatchObject({ organized: true });
    expect(members(first)).toEqual([a, b]); expect(members(untouched)).toEqual([intake]);
  });
  it('collects scattered visits manually without consulting capture time', () => {
    const intake = ensureIntake(eventId); const child = createCollection(eventId, 'Striped shirt');
    const first = addPhoto(intake, 'early', '2026-09-24T08:00:00Z'); const friend = addPhoto(intake, 'in-between', '2026-09-24T12:00:00Z'); const later = addPhoto(intake, 'late', '2026-09-24T18:00:00Z');
    organizePhotos({ eventId, photoIds: [first, later], targetId: child, mode: 'add' });
    expect(listPhotos(child).map((p) => p.id)).toEqual([first, later]); expect(listPhotos(intake).map((p) => p.id)).toEqual([friend]);
    expect(listEventPhotos(eventId)).toHaveLength(3);
  });
  it('shares one group photo across children; moving from one preserves the other', () => {
    const intake = ensureIntake(eventId), a = createCollection(eventId, 'A'), b = createCollection(eventId, 'B'), c = createCollection(eventId, 'Friends');
    const photoId = addPhoto(intake);
    organizePhotos({ eventId, photoIds: [photoId], targetId: a, mode: 'add' });
    organizePhotos({ eventId, photoIds: [photoId], targetId: b, mode: 'add' });
    setGalleryCover(a, photoId);
    organizePhotos({ eventId, photoIds: [photoId], sourceId: a, targetId: c, mode: 'move' });
    expect(members(photoId)).toEqual([b, c]); expect(db.select().from(schema.photos).get()!.galleryId).toBe(intake);
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
    expect(listGalleries(eventId).find((g) => g.id === a)?.coverPhotoId).toBeNull();
    expect(setGalleryCover(a, photoId)).toBe(false); expect(setGalleryCover(b, photoId)).toBe(true);
  });
  it('rejects a mixed-event selection atomically without creating a collection or moving a valid photo', () => {
    const intake = ensureIntake(eventId); const valid = addPhoto(intake);
    const otherEvent = createEvent({ name: 'Different event' }).id; const other = addPhoto(ensureIntake(otherEvent));
    const count = listGalleries(eventId).length;
    expect(() => organizePhotos({ eventId, photoIds: [valid, other], newLabel: 'Must not be created', mode: 'add' })).toThrow('Nothing was changed');
    expect(listGalleries(eventId)).toHaveLength(count); expect(members(valid)).toEqual([intake]);
  });
  it('merges equal filenames losslessly and keeps photo IDs and storage anchors stable', () => {
    const a = createCollection(eventId, 'First visit'), b = createCollection(eventId, 'Back again');
    const first = addPhoto(a), second = addPhoto(b);
    expect(mergeCollections(eventId, a, b)).toBe(1);
    expect(listPhotos(b).map((p) => p.id)).toEqual([first, second]);
    expect(db.select().from(schema.photos).all().map((p) => p.galleryId)).toEqual([a, b]);
    expect(listGalleries(eventId).some((g) => g.id === a)).toBe(false);
    archiveCollection(eventId, a, true); expect(listPhotos(a).map((p) => p.id)).toEqual([first]);
  });
  it('archives reversibly and puts otherwise uncollected photos in the private tray', () => {
    const child = createCollection(eventId, 'A child'); const photoId = addPhoto(child);
    archiveCollection(eventId, child); const intake = ensureIntake(eventId);
    expect(listPhotos(intake).map((p) => p.id)).toEqual([photoId]);
    archiveCollection(eventId, child, true);
    expect(listPhotos(intake)).toHaveLength(0); expect(listPhotos(child)).toHaveLength(1);
    expect(() => archiveCollection(eventId, intake)).toThrow('stays available');
  });
  it('legacy collection removal archives the canonical anchor instead of cascading shared originals', () => {
    const anchor = createCollection(eventId, 'Original'), other = createCollection(eventId, 'Friend'); const photoId = addPhoto(anchor);
    organizePhotos({ eventId, photoIds: [photoId], targetId: other, mode: 'add' });
    expect(deleteGallery(anchor)).toEqual({ ok: true });
    expect(listPhotos(other).map((p) => p.id)).toEqual([photoId]);
    expect(db.select().from(schema.photos).get()!.galleryId).toBe(anchor);
    expect(listGalleries(eventId, true).find((g) => g.id === anchor)?.isArchived).toBe(1);
  });
  it('refuses ambiguous move-from-all, invalid covers, stale sources and cross-event targets', () => {
    const a = createCollection(eventId), b = createCollection(eventId); const photoId = addPhoto(a);
    expect(() => organizePhotos({ eventId, photoIds: [photoId], targetId: b, mode: 'move' })).toThrow('Open a collection');
    expect(() => organizePhotos({ eventId, photoIds: [photoId], sourceId: b, targetId: a, mode: 'move' })).toThrow('nothing was changed');
    expect(setGalleryCover(b, photoId)).toBe(false);
    const other = createEvent({ name: 'Other' }); const target = createCollection(other.id);
    expect(() => organizePhotos({ eventId, photoIds: [photoId], targetId: target, mode: 'add' })).toThrow('this event');
    expect(members(photoId)).toEqual([a]);
  });
});

describe('photographer offering and settings round trips', () => {
  it('clears an event override to follow the catalog and retains cost in the actual admin loader', async () => {
    seedCatalog(); const p = loadCatalog(null, true).products[0];
    updateProduct(p.id, { costCents: 345 }); setEventProduct(eventId, p.id, { priceCentsOverride: 1234 }); setEventProduct(eventId, p.id, { priceCentsOverride: null });
    expect(eventCatalog(eventId, null).catalog.products.find((x) => x.id === p.id)?.priceCents).toBe(p.priceCents);
    const loaded = await (catalogLoad as unknown as () => Promise<{ costs: Record<number, number> }>)(); expect(loaded.costs[p.id]).toBe(345);
    expect(() => setEventProduct(eventId, p.id, { priceCentsOverride: -1 })).toThrow(); expect(() => updateProduct(p.id, { priceCents: -1 })).toThrow();
  });
  it('authors a package by sizes/counts and duplicates without changing existing offerings', () => {
    seedCatalog(); const id = createPrintPackage({ name: 'Family favorites', priceCents: 2200, contents: [{ size: '8x10', count: 1 }, { size: 'wallet', count: 4 }] });
    const c = loadCatalog(null, true); const p = c.products.find((x) => x.id === id)!;
    expect(p.sheets.flatMap((s) => c.sheets[s.templateCode].cells)).toHaveLength(5);
    const copy = duplicateProduct(id); expect(loadCatalog(null, true).products.find((x) => x.id === copy)?.active).toBe(false);
    updateProduct(id, { name: 'My own wording', priceCents: 2710 }); seedCatalog();
    expect(loadCatalog(null, true).products.find((x) => x.id === id)?.name).toBe('My own wording');
    const original = c.products.find((x) => x.code === 'single_8x10')!; updateProduct(original.id, { name: 'Custom default name', description: 'Keep this' }); seedCatalog();
    expect(loadCatalog(null, true).products.find((x) => x.id === original.id)?.name).toBe('Custom default name');
  });
  it('saves a browser-local closing time as UTC consistently regardless of server timezone', async () => {
    const form = new FormData(); form.set('name', 'All the happy chaos'); form.set('expiresLocal', '2026-09-24T10:30'); form.set('timezoneOffset', '420');
    await (eventActions.update as Function)({ params: { id: String(eventId) }, request: new Request('http://fixture.invalid', { method: 'POST', body: form }) });
    expect(db.select().from(schema.events).where(eq(schema.events.id, eventId)).get()!.expiresAt).toBe('2026-09-24T17:30:00.000Z');
  });
});
