import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { normalizeOrderReferenceLabel } from '$shared/terminology';
import { nowIso } from './env';
import { randomId } from './ids';
import type { Event } from './db/schema';
import { archiveCollection } from './grouping';
import { ensureDeliveryVersions } from './delivery';
import { comparePhotoOrder } from '$shared/photo-order';
import { compareCollectionNames } from '$shared/collection-order';
import { activeCollectionCounts, chooseCollectionCover } from './collection-covers';

export function listEvents() {
  return db.select({
    id: schema.events.id, slug: schema.events.slug, name: schema.events.name, eventDate: schema.events.eventDate,
    isPublished: schema.events.isPublished, orderingEnabled: schema.events.orderingEnabled, expiresAt: schema.events.expiresAt, subjectLabel: schema.events.subjectLabel, createdAt: schema.events.createdAt,
    galleryCount: sql<number>`(select count(*) from galleries g where g.event_id = events.id)`,
    photoCount: sql<number>`(select count(*) from photos p join galleries g on g.id = p.gallery_id where g.event_id = events.id)`,
    newOrders: sql<number>`(select count(*) from orders o where o.event_id = events.id and o.status = 'new')`
  }).from(schema.events).orderBy(desc(schema.events.createdAt)).all();
}

export function getEvent(id: number): Event | undefined { return db.select().from(schema.events).where(eq(schema.events.id, id)).get(); }
export function getEventBySlug(slug: string): Event | undefined { return db.select().from(schema.events).where(eq(schema.events.slug, slug)).get(); }

export function createEvent(input: { name: string; subjectLabel?: string; eventDate?: string | null; catalogId?: number | null; orderingEnabled?: boolean; galleryLayout?: 'directory' | 'simple' | 'sections' }): Event {
  const now = nowIso();
  return sqlite.transaction(() => {
  const event = db.insert(schema.events).values({
    slug: uniqueSlug(), name: input.name.trim(), subjectLabel: normalizeOrderReferenceLabel(input.subjectLabel), eventDate: input.eventDate || null,
    variantPolicy: { social: 'free', print: 'free', raw: 'free' }, isPublished: 0, orderingEnabled: input.orderingEnabled === false ? 0 : 1, galleryLayout: input.galleryLayout ?? 'directory', catalogId: input.catalogId ?? null,
    createdAt: now, updatedAt: now
  }).returning().get();
  ensureDeliveryVersions(event.id);
  return event;
  })();
}

function uniqueSlug(): string {
  for (let i = 0; i < 10; i++) { const s = randomId(12); if (!getEventBySlug(s)) return s; }
  throw new Error('could not allocate slug');
}

export function rotateSlug(eventId: number): string {
  const slug = uniqueSlug();
  db.update(schema.events).set({ slug, updatedAt: nowIso() }).where(eq(schema.events.id, eventId)).run();
  return slug;
}

export function updateEvent(id: number, patch: Partial<typeof schema.events.$inferInsert>): void {
  db.update(schema.events).set({ ...patch, updatedAt: nowIso() }).where(eq(schema.events.id, id)).run();
}

export function deleteEvent(id: number): { ok: boolean; reason?: string } {
  const undelivered = db.select({ n: sql<number>`count(*)` }).from(schema.orders)
    .where(and(eq(schema.orders.eventId, id), sql`${schema.orders.status} not in ('delivered','cancelled')`)).get()?.n ?? 0;
  if (undelivered > 0) return { ok: false, reason: `${undelivered} undelivered order(s) reference this event` };
  db.delete(schema.events).where(eq(schema.events.id, id)).run();
  return { ok: true };
}

// ---- galleries -------------------------------------------------------------

export interface GalleryTile {
  id: number; publicId: string; name: string; publicTitle: string | null; publicDescription: string | null; sortOrder: number; coverPhotoId: number | null;
  isIntake: number; isArchived: number; photoCount: number; coverThumbId: number | null; coverHash: string | null;
}

export function listGalleries(eventId: number, includeArchived = false): GalleryTile[] {
  const policy = getEvent(eventId)?.collectionCoverPolicy ?? 'exclusive';
  const counts = activeCollectionCounts(eventId);
  return sqlite.prepare(`SELECT g.id, g.public_id AS publicId, g.name, g.public_title AS publicTitle, g.public_description AS publicDescription, g.sort_order AS sortOrder,
    g.cover_photo_id AS coverPhotoId, g.is_intake AS isIntake, g.is_archived AS isArchived,
    (SELECT count(*) FROM gallery_photos gp WHERE gp.gallery_id = g.id) AS photoCount
    FROM galleries g WHERE g.event_id = ? ${includeArchived ? '' : 'AND g.is_archived = 0'} ORDER BY g.is_intake DESC, g.sort_order, g.id`)
    .all(eventId).map((row) => {
      const r = row as Omit<GalleryTile, 'coverHash' | 'coverThumbId'>;
      const candidates = sqlite.prepare(`SELECT p.id, p.stem, p.sort_order AS sortOrder, gp.position AS collectionPosition, p.rendition_hash AS hash
        FROM photos p JOIN gallery_photos gp ON gp.photo_id = p.id
        WHERE gp.gallery_id = ? AND p.rendition_status = 'ready'`).all(r.id) as { id: number; stem: string; sortOrder: number; hash: string | null }[];
      const cover = chooseCollectionCover(candidates, r.coverPhotoId, r.isIntake ? 'first' : policy, counts);
      return { ...r, coverThumbId: cover?.id ?? null, coverHash: cover?.hash ?? null };
    });
}

export function getGallery(id: number) { return db.select().from(schema.galleries).where(eq(schema.galleries.id, id)).get(); }
export function getGalleryByPublicId(eventId: number, publicId: string) {
  return db.select().from(schema.galleries).where(and(eq(schema.galleries.eventId, eventId), eq(schema.galleries.publicId, publicId))).get();
}

/** Bulk create. Duplicate names (within the input or against existing) are reported, not silently merged: two Emmas is normal. */
export function createGalleries(eventId: number, names: string[]): { created: string[]; duplicates: string[] } {
  const existing = new Set(db.select({ name: schema.galleries.name }).from(schema.galleries).where(eq(schema.galleries.eventId, eventId)).all().map((g) => normalizeName(g.name)));
  const created: string[] = []; const duplicates: string[] = [];
  const seen = new Set<string>();
  let order = db.select({ m: sql<number>`coalesce(max(sort_order), 0)` }).from(schema.galleries).where(eq(schema.galleries.eventId, eventId)).get()?.m ?? 0;
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = normalizeName(name);
    if (existing.has(key) || seen.has(key)) { duplicates.push(name); }
    seen.add(key);
    db.insert(schema.galleries).values({ eventId, publicId: uniquePublicId(), name, sortOrder: ++order, createdAt: nowIso() }).run();
    created.push(name);
  }
  return { created, duplicates };
}

export function normalizeName(s: string): string { return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim(); }

function uniquePublicId(): string {
  for (let i = 0; i < 10; i++) { const p = randomId(8); if (!db.select({ id: schema.galleries.id }).from(schema.galleries).where(eq(schema.galleries.publicId, p)).get()) return p; }
  throw new Error('could not allocate public id');
}

export function renameGallery(id: number, name: string): void { db.update(schema.galleries).set({ name: name.trim() }).where(eq(schema.galleries.id, id)).run(); }
export function setGalleryCover(id: number, photoId: number | null): boolean {
  if (photoId != null) {
    const member = sqlite.prepare("SELECT 1 FROM gallery_photos gp JOIN photos p ON p.id=gp.photo_id WHERE gp.gallery_id=? AND gp.photo_id=? AND p.rendition_status='ready'").get(id, photoId);
    if (!member) return false;
  }
  db.update(schema.galleries).set({ coverPhotoId: photoId }).where(eq(schema.galleries.id, id)).run();
  return true;
}
/** Legacy callers must never delete a canonical storage anchor shared by other collections. */
export function deleteGallery(id: number): { ok: boolean; reason?: string } {
  const gallery = getGallery(id);
  if (!gallery) return { ok: false, reason: 'Collection not found.' };
  try { archiveCollection(gallery.eventId, id); return { ok: true }; }
  catch (err) { return { ok: false, reason: err instanceof Error ? err.message : 'Could not archive collection.' }; }
}

// ---- photos ---------------------------------------------------------------

export interface PhotoWithFiles {
  id: number; galleryId: number; stem: string; displayName: string; takenAt: string | null; shootDay: 1 | 2 | null; width: number | null; height: number | null;
  renditionStatus: string; renditionHash: string | null; sortOrder: number; collectionPosition?: number | null; collections: { id: number; name: string; isIntake: number }[]; renderError: string | null;
  files: { id: number; role: string; originalFilename: string; ext: string; mime: string; bytes: number; width: number | null; height: number | null; downloadable: number; sha256: string; photoId?: number; origin?: 'uploaded' | 'generated'; available?: number; sourceFileId?: number | null; sourceSha256?: string | null }[];
}

export function listPhotos(galleryId: number): PhotoWithFiles[] {
  const ids = sqlite.prepare('SELECT photo_id, position FROM gallery_photos WHERE gallery_id = ?').all(galleryId) as { photo_id: number; position: number | null }[];
  const positions = new Map(ids.map(p => [p.photo_id, p.position]));
  return photosWithFiles(ids.map((p) => p.photo_id)).map(p => ({ ...p, collectionPosition: positions.get(p.id) ?? null })).sort(comparePhotoOrder);
}
export function listEventPhotos(eventId: number): PhotoWithFiles[] {
  const ids = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id = p.gallery_id WHERE g.event_id = ?').all(eventId) as { id: number }[];
  return photosWithFiles(ids.map((p) => p.id));
}
function photosWithFiles(ids: number[]): PhotoWithFiles[] {
  if (!ids.length) return [];
  const rows = db.select().from(schema.photos).where(inArray(schema.photos.id, ids)).all().sort(comparePhotoOrder);
  if (!rows.length) return [];
  const files = db.select().from(schema.photoFiles).where(inArray(schema.photoFiles.photoId, rows.map((r) => r.id))).all();
  const byPhoto = new Map<number, PhotoWithFiles['files']>();
  for (const f of files) {
    const arr = byPhoto.get(f.photoId) ?? [];
    arr.push({ photoId: f.photoId, origin:f.origin, available:f.available, sourceFileId:f.sourceFileId, sourceSha256:f.sourceSha256, id: f.id, role: f.role, originalFilename: f.originalFilename, ext: f.ext, mime: f.mime, bytes: f.bytes, width: f.width, height: f.height, downloadable: f.downloadable, sha256: f.sha256 });
    byPhoto.set(f.photoId, arr);
  }
  return rows.map((r) => ({ ...r, files: (byPhoto.get(r.id) ?? []).sort((a, b) => ['social', 'print', 'raw'].indexOf(a.role) - ['social', 'print', 'raw'].indexOf(b.role)),
    collections: (sqlite.prepare('SELECT g.id, g.name, g.is_intake AS isIntake FROM galleries g JOIN gallery_photos gp ON gp.gallery_id = g.id WHERE gp.photo_id = ? AND g.is_archived = 0').all(r.id) as PhotoWithFiles['collections']).sort(compareCollectionNames),
    renderError: (sqlite.prepare("SELECT last_error FROM jobs WHERE type = 'render_photo' AND json_extract(payload, '$.photoId') = ? AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1").get(r.id) as { last_error: string } | undefined)?.last_error ?? null
  }));
}

export function getPhoto(id: number) { return db.select().from(schema.photos).where(eq(schema.photos.id, id)).get(); }

/** Event id for a photo (through its gallery), used by media/download access checks. */
export function photoEventId(photoId: number): number | null {
  return db.select({ eventId: schema.galleries.eventId }).from(schema.photos).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId)).where(eq(schema.photos.id, photoId)).get()?.eventId ?? null;
}
