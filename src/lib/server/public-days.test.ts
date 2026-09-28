import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: { secret: 'isolated-public-day-test', publicOrigin: 'https://fixture.invalid', isProd: false }, nowIso: () => new Date().toISOString() }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});

import { db, schema, sqlite } from './db';
import { createEvent, listGalleries, listPhotos } from './events';
import { publicDayCounts, publicGalleries, publicPhotos } from './public';

let event: typeof schema.events.$inferSelect;
let first: number, second: number, hidden: number, archived: number;
let day1: number, day2: number, unlabeled: number;
const now = new Date().toISOString();
function gallery(label: string, flags = {}) {
  return db.insert(schema.galleries).values({ eventId: event.id, publicId: label, name: `PRIVATE ${label}`, createdAt: now, ...flags }).returning().get().id;
}
function photo(galleryId: number, shootDay: 1 | 2 | null, ready = true) {
  const n = (sqlite.prepare('SELECT count(*) AS n FROM photos').get() as { n: number }).n;
  const id = db.insert(schema.photos).values({ galleryId, stem: `private-${n}`, displayName: 'PRIVATE PHOTO', shootDay, renditionStatus: ready ? 'ready' : 'pending', renditionHash: 'a-render-hash', createdAt: now, updatedAt: now }).returning().get().id;
  db.insert(schema.galleryPhotos).values({ galleryId, photoId: id }).run();
  return id;
}
beforeEach(() => {
  sqlite.exec('DELETE FROM events');
  event = createEvent({ name: 'A two-day event' });
  first = gallery('first'); second = gallery('second'); hidden = gallery('hidden', { isIntake: 1 }); archived = gallery('archived', { isArchived: 1 });
  day1 = photo(first, 1); day2 = photo(first, 2); unlabeled = photo(first, null);
  db.insert(schema.galleryPhotos).values({ galleryId: second, photoId: day2 }).run();
  photo(hidden, 1); photo(archived, 2); photo(first, 1, false);
  sqlite.prepare('UPDATE galleries SET cover_photo_id = ? WHERE id = ?').run(day1, first);
});
afterAll(() => sqlite.close());

describe('public browsing across shoot days', () => {
  it('counts shared shots once and excludes private, archived-only and unfinished photos', () => {
    expect(publicDayCounts(event)).toEqual({ all: 3, day1: 1, day2: 1, unassigned: 1 });
    const another = createEvent({ name: 'Other event' });
    expect(publicDayCounts(another)).toEqual({ all: 0, day1: 0, day2: 0, unassigned: 0 });
  });

  it('uses a matching day cover and count without changing the chosen all-days cover', () => {
    const rows = listGalleries(event.id);
    const all = publicGalleries(rows, event);
    expect(all.find(g => g.id === first)).toMatchObject({ photoCount: 3, coverThumbId: day1 });
    const firstDay = publicGalleries(rows, event, 1);
    expect(firstDay.map(g => g.id)).toEqual([first]);
    expect(firstDay[0]).toMatchObject({ photoCount: 1, coverThumbId: day1 });
    const secondDay = publicGalleries(rows, event, 2);
    expect(secondDay).toHaveLength(2);
    for (const g of secondDay) expect(g).toMatchObject({ photoCount: 1, coverThumbId: day2 });
    expect(publicGalleries(rows, event).find(g => g.id === first)?.coverThumbId).toBe(day1);
  });

  it('keeps full public photo identities and stable shared links independent of day filtering', () => {
    const payload = publicPhotos(listPhotos(first), event.variantPolicy, event);
    expect(payload.map(p => [p.id, p.shootDay])).toEqual([[day1, 1], [day2, 2], [unlabeled, null]]);
    expect(payload.find(p => p.id === day2)?.shareUrl).toBe(`/g/${event.slug}/p/${day2}`);
    expect(publicPhotos(listPhotos(second), event.variantPolicy, event)[0].id).toBe(day2);
    expect(JSON.stringify(payload)).not.toContain('PRIVATE');
  });
});
