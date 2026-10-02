import { sqlite } from './db';
import { getEvent, listPhotos, updateEvent } from './events';

export class PresentationError extends Error {}

function ownCollection(eventId: number, galleryId: number) {
  const row = sqlite.prepare('SELECT id FROM galleries WHERE id=? AND event_id=? AND is_intake=0 AND is_archived=0').get(galleryId, eventId);
  if (!row) throw new PresentationError('Choose an active collection in this project.');
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max) throw new PresentationError(`Enter text up to ${max} characters.`);
  return value.trim() || null;
}

export function saveGalleryLayout(eventId: number, layout: unknown) {
  if (!getEvent(eventId)) throw new PresentationError('Project not found.');
  if (layout !== 'directory' && layout !== 'simple' && layout !== 'sections') throw new PresentationError('Choose a gallery layout.');
  // Presentation never changes publication, access, membership or sales.
  updateEvent(eventId, { galleryLayout: layout });
}

export function savePublicCollection(eventId: number, galleryId: number, title: unknown, description: unknown) {
  ownCollection(eventId, galleryId);
  const publicTitle = optionalText(title, 120), publicDescription = optionalText(description, 2000);
  sqlite.prepare('UPDATE galleries SET public_title=?,public_description=? WHERE id=? AND event_id=?')
    .run(publicTitle, publicDescription, galleryId, eventId);
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 10000 || value.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(value).size !== value.length)
    throw new PresentationError('Choose a complete, unique photo sequence.');
  return value;
}

/** Optimistic comparison prevents a stale editor overwriting a concurrent reorder or membership change. */
export function saveCollectionSequence(eventId: number, galleryId: number, sequence: unknown, expected: unknown, reset = false) {
  const next = ids(sequence), before = ids(expected);
  sqlite.transaction(() => {
    ownCollection(eventId, galleryId);
    const current = listPhotos(galleryId).map(photo => photo.id);
    if (JSON.stringify(current) !== JSON.stringify(before)) throw new PresentationError('This collection changed. Reload it before saving a new sequence.');
    const members = new Set(current);
    if (next.length !== current.length || next.some(id => !members.has(id))) throw new PresentationError('The sequence must include every photo in this collection exactly once.');
    const update = sqlite.prepare('UPDATE gallery_photos SET position=? WHERE gallery_id=? AND photo_id=?');
    next.forEach((id, position) => update.run(reset ? null : position, galleryId, id));
  })();
}

export function saveCollectionSequenceOrder(eventId: number, next: unknown, expected: unknown) {
  const sequence = ids(next), before = ids(expected);
  sqlite.transaction(() => {
    const current = (sqlite.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=0 AND is_archived=0 ORDER BY sort_order,id').all(eventId) as {id:number}[]).map(g=>g.id);
    if (JSON.stringify(current) !== JSON.stringify(before)) throw new PresentationError('The collection list changed. Reload before saving its order.');
    const members = new Set(current);
    if (sequence.length !== current.length || sequence.some(id=>!members.has(id))) throw new PresentationError('Include every active collection exactly once.');
    const update = sqlite.prepare('UPDATE galleries SET sort_order=? WHERE id=? AND event_id=?');
    sequence.forEach((id, index) => update.run(index, id, eventId));
  })();
}
