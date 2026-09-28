import { sqlite } from './db';
import { nowIso } from './env';
import { randomId } from './ids';

export class GroupingError extends Error {}
export interface CollectionRow { id: number; event_id: number; name: string; is_intake: number; is_archived: number; }
function collection(eventId: number, id: number, allowArchived = false): CollectionRow {
  const row = sqlite.prepare('SELECT * FROM galleries WHERE id = ? AND event_id = ?').get(id, eventId) as CollectionRow | undefined;
  if (!row || (!allowArchived && row.is_archived)) throw new GroupingError('That collection is no longer available in this event.');
  return row;
}
export function createCollection(eventId: number, label = '', isIntake = false): number {
  if (!sqlite.prepare('SELECT id FROM events WHERE id = ?').get(eventId)) throw new GroupingError('Event not found.');
  const count = (sqlite.prepare('SELECT count(*) AS n FROM galleries WHERE event_id = ?').get(eventId) as { n: number }).n;
  const name = label.trim().replace(/\s+/g, ' ').slice(0, 120) || `Collection ${String(count + 1).padStart(2, '0')}`;
  const result = sqlite.prepare('INSERT INTO galleries (event_id, public_id, name, sort_order, is_intake, is_archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(eventId, randomId(12), name, count + 1, isIntake ? 1 : 0, nowIso());
  return Number(result.lastInsertRowid);
}
export function ensureIntake(eventId: number): number {
  const existing = sqlite.prepare('SELECT id FROM galleries WHERE event_id = ? AND is_intake = 1 AND is_archived = 0 ORDER BY id LIMIT 1').get(eventId) as { id: number } | undefined;
  return existing?.id ?? createCollection(eventId, 'To sort', true);
}

/** Add a selection to several child collections atomically; repeat submissions are harmless.
 * Only private intake membership is removed. Other children, source files and orders stay intact. */
export function addPhotosToCollections(eventId: number, photoIds: number[], targetIds: number[]): { count: number; collections: number } {
  return sqlite.transaction(() => {
    const ids = [...new Set(photoIds)], targets = [...new Set(targetIds)];
    if (!ids.length || ids.length > 5000 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new GroupingError('Choose between 1 and 5,000 photos.');
    if (!targets.length || targets.length > 200 || targets.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new GroupingError('Choose between 1 and 200 collections.');
    for (const target of targets) if (collection(eventId, target).is_intake) throw new GroupingError('Choose child collections. To return photos to the private tray, use Move.');
    const valid = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id = p.gallery_id WHERE p.id = ? AND g.event_id = ?');
    for (const id of ids) if (!valid.get(id, eventId)) throw new GroupingError('Every selected photo must belong to this event. Nothing was changed.');
    const add = sqlite.prepare('INSERT OR IGNORE INTO gallery_photos (gallery_id, photo_id) VALUES (?, ?)');
    const clearIntake = sqlite.prepare('DELETE FROM gallery_photos WHERE photo_id = ? AND gallery_id IN (SELECT id FROM galleries WHERE event_id = ? AND is_intake = 1)');
    for (const id of ids) {
      for (const target of targets) add.run(target, id);
      clearIntake.run(id, eventId);
    }
    return { count: ids.length, collections: targets.length };
  })();
}

/** The canonical photos.gallery_id never changes: originals, shared links and order IDs stay stable.
 * Add shares membership. Move removes ONLY the source membership; other children keep the group photo. */
export function organizePhotos(input: { eventId: number; photoIds: number[]; targetId?: number; newLabel?: string; sourceId?: number; mode: 'add' | 'move' }): { targetId: number; count: number } {
  return sqlite.transaction(() => {
    const ids = [...new Set(input.photoIds)];
    if (!ids.length || ids.length > 5000 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new GroupingError('Choose between 1 and 5,000 photos.');
    if (input.mode !== 'add' && input.mode !== 'move') throw new GroupingError('Choose add or move.');
    if (input.mode === 'move' && !input.sourceId) throw new GroupingError('Open a collection before moving photos out of it. From All photos, use Add.');
    if (input.sourceId) collection(input.eventId, input.sourceId);
    const valid = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id = p.gallery_id WHERE p.id = ? AND g.event_id = ?');
    const member = sqlite.prepare('SELECT 1 FROM gallery_photos WHERE gallery_id = ? AND photo_id = ?');
    for (const id of ids) {
      if (!valid.get(id, input.eventId)) throw new GroupingError('Every selected photo must belong to this event. Nothing was changed.');
      if (input.sourceId && !member.get(input.sourceId, id)) throw new GroupingError('Some photos left this collection. Refresh and try again; nothing was changed.');
    }
    const targetId = input.targetId || createCollection(input.eventId, input.newLabel);
    collection(input.eventId, targetId);
    if (targetId === input.sourceId && input.mode === 'move') throw new GroupingError('Choose a different destination.');
    const add = sqlite.prepare('INSERT OR IGNORE INTO gallery_photos (gallery_id, photo_id) VALUES (?, ?)');
    for (const id of ids) {
      add.run(targetId, id);
      if (input.mode === 'move') sqlite.prepare('DELETE FROM gallery_photos WHERE gallery_id = ? AND photo_id = ?').run(input.sourceId!, id);
      // Once deliberately placed, remove private intake membership. Never remove another child's collection.
      if (!(collection(input.eventId, targetId).is_intake)) sqlite.prepare('DELETE FROM gallery_photos WHERE photo_id = ? AND gallery_id IN (SELECT id FROM galleries WHERE event_id = ? AND is_intake = 1)').run(id, input.eventId);
    }
    sqlite.prepare('UPDATE galleries SET cover_photo_id = NULL WHERE event_id = ? AND cover_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gallery_photos gp WHERE gp.gallery_id = galleries.id AND gp.photo_id = galleries.cover_photo_id)').run(input.eventId);
    return { targetId, count: ids.length };
  })();
}

/** A merge changes memberships, never photo identity or storage; retain the source as a restorable archive. */
export function mergeCollections(eventId: number, sourceId: number, targetId: number): number {
  return sqlite.transaction(() => {
    const source = collection(eventId, sourceId); collection(eventId, targetId);
    if (sourceId === targetId || source.is_intake) throw new GroupingError('Choose two different child collections.');
    const ids = sqlite.prepare('SELECT photo_id FROM gallery_photos WHERE gallery_id = ?').all(sourceId) as { photo_id: number }[];
    if (ids.length) organizePhotos({ eventId, photoIds: ids.map((p) => p.photo_id), sourceId, targetId, mode: 'add' });
    // Archived membership is retained for restoration and old photographer context, but never parent-visible.
    sqlite.prepare('UPDATE galleries SET is_archived = 1 WHERE id = ?').run(sourceId);
    return ids.length;
  })();
}
export function archiveCollection(eventId: number, galleryId: number, restore = false): void {
  sqlite.transaction(() => {
    const row = collection(eventId, galleryId, true);
    if (row.is_intake) throw new GroupingError('The To sort tray stays available for new photos.');
    if (!restore) {
      const otherwiseHidden = sqlite.prepare(`SELECT gp.photo_id FROM gallery_photos gp WHERE gp.gallery_id = ? AND NOT EXISTS (
        SELECT 1 FROM gallery_photos other JOIN galleries g ON g.id = other.gallery_id
        WHERE other.photo_id = gp.photo_id AND g.id != ? AND g.is_archived = 0)`)
        .all(galleryId, galleryId) as { photo_id: number }[];
      if (otherwiseHidden.length) {
        const intake = ensureIntake(eventId);
        for (const p of otherwiseHidden) sqlite.prepare('INSERT OR IGNORE INTO gallery_photos (gallery_id, photo_id) VALUES (?, ?)').run(intake, p.photo_id);
      }
    }
    sqlite.prepare('UPDATE galleries SET is_archived = ? WHERE id = ?').run(restore ? 0 : 1, galleryId);
    if (restore) sqlite.prepare('DELETE FROM gallery_photos WHERE gallery_id IN (SELECT id FROM galleries WHERE event_id = ? AND is_intake = 1) AND photo_id IN (SELECT photo_id FROM gallery_photos WHERE gallery_id = ?)').run(eventId, galleryId);
  })();
}
