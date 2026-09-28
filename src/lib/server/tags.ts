import { sqlite } from './db';
import { randomId } from './ids';
import { nowIso } from './env';
import { tagDescendants, tagIsShared, matchesTags, type PhotoTag } from '$shared/tags';

export function listTags(eventId: number): PhotoTag[] {
  return (sqlite.prepare('SELECT id,public_id AS publicId,parent_id AS parentId,name,shared,legacy_day AS legacyDay FROM tags WHERE event_id=? ORDER BY id').all(eventId) as (Omit<PhotoTag,'shared'> & { shared: number })[]).map(t => ({...t,shared:!!t.shared}));
}
function ownTag(eventId: number, id: number) { const t = listTags(eventId).find(t => t.id === id); if (!t) throw new Error('Tag not found in this project.'); return t; }
function cleanName(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('Use a tag name between 1 and 100 characters.'); return value.trim().normalize('NFC'); }
export function saveTag(eventId: number, input: { id?: number; name: string; parentId?: number | null; shared: boolean }): PhotoTag {
  return sqlite.transaction(() => {
    if (!sqlite.prepare('SELECT id FROM events WHERE id=?').get(eventId)) throw new Error('Project not found.');
    const tags = listTags(eventId), name = cleanName(input.name), parent = input.parentId ?? null;
    if (parent !== null) ownTag(eventId,parent);
    if (input.id) { ownTag(eventId,input.id); if (parent !== null && tagDescendants(tags,input.id).has(parent)) throw new Error('A tag cannot be placed inside itself or a descendant.'); }
    if (tags.some(t => t.id !== input.id && t.parentId === parent && t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That name already exists at this level.');
    const id = input.id ?? Number(sqlite.prepare('INSERT INTO tags(event_id,public_id,parent_id,name,shared,created_at) VALUES(?,?,?,?,?,?)').run(eventId,randomId(18),parent,name,input.shared ? 1 : 0,nowIso()).lastInsertRowid);
    if (input.id) sqlite.prepare('UPDATE tags SET name=?,parent_id=?,shared=? WHERE id=?').run(name,parent,input.shared ? 1 : 0,id);
    return ownTag(eventId,id);
  })();
}
export function deleteTag(eventId: number, id: number) {
  return sqlite.transaction(() => { ownTag(eventId,id); if (listTags(eventId).some(t => t.parentId === id)) throw new Error('Move or remove child tags first.'); sqlite.prepare('DELETE FROM tags WHERE id=?').run(id); })();
}
export function validateTagIds(eventId: number, ids: number[]) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Choose valid project tags.');
  for (const id of new Set(ids)) ownTag(eventId,id);
}
export function changePhotoTags(eventId: number, photos: number[], ids: number[], mode: 'add' | 'remove') {
  return sqlite.transaction(() => {
    validateTagIds(eventId,ids);
    if (!ids.length || !photos.length || photos.length > 10000 || photos.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Select photos and at least one tag.');
    const own = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=? AND g.event_id=?');
    for (const id of new Set(photos)) if (!own.get(id,eventId)) throw new Error('A selected photo is not in this project.');
    const stmt = sqlite.prepare(mode === 'add' ? 'INSERT OR IGNORE INTO photo_tags(photo_id,tag_id) VALUES(?,?)' : 'DELETE FROM photo_tags WHERE photo_id=? AND tag_id=?');
    for (const photo of new Set(photos)) for (const tag of new Set(ids)) stmt.run(photo,tag);
    return new Set(photos).size;
  })();
}
export function tagAssignments(eventId: number): Record<number,number[]> {
  const result: Record<number,number[]> = {};
  for (const row of sqlite.prepare('SELECT pt.photo_id AS photoId,pt.tag_id AS tagId FROM photo_tags pt JOIN tags t ON t.id=pt.tag_id WHERE t.event_id=?').all(eventId) as {photoId:number;tagId:number}[]) (result[row.photoId] ??= []).push(row.tagId);
  return result;
}
/** Legacy clients remain compatible; this is never used as a fresh-project template. */
export function legacyDayTag(eventId: number, day: number) {
  const existing = listTags(eventId).find(t => t.legacyDay === day); if (existing) return existing.id;
  let root = listTags(eventId).find(t => t.parentId === null && t.name === 'Days');
  root ??= saveTag(eventId,{name:'Days',shared:true});
  const child = listTags(eventId).find(t => t.parentId === root.id && t.name === `Day ${day}`) ?? saveTag(eventId,{name:`Day ${day}`,parentId:root.id,shared:true});
  sqlite.prepare('UPDATE tags SET legacy_day=? WHERE id=?').run(day,child.id); return child.id;
}
export function publicTagData(eventId: number, photoIds: number[], params: URLSearchParams) {
  const allTags = listTags(eventId), assignments = tagAssignments(eventId);
  const shared = allTags.filter(t => tagIsShared(allTags,t.id));
  const legacy = params.get('day');
  const requested = [...new Set((params.get('tags') ?? '').split(',').filter(Boolean))];
  if (legacy && !requested.length) { const t = shared.find(t => t.legacyDay === Number(legacy)); if (t) requested.push(t.publicId); }
  if (requested.length > 100 || requested.some(id => !shared.some(t => t.publicId === id))) throw new Error('This filter is no longer shared.');
  const mode: 'all' | 'any' = params.get('match') === 'all' ? 'all' : 'any';
  const chosen = shared.filter(t => requested.includes(t.publicId)).map(t => t.id);
  const selectedIds = photoIds.filter(id => matchesTags(shared,assignments[id] ?? [],chosen,mode));
  const tags = shared.map(t => ({...t, count:photoIds.filter(id => matchesTags(shared,assignments[id] ?? [],[t.id])).length})).filter(t => t.count || chosen.includes(t.id));
  // Public fields are only deliberately shared labels. No private XMP or assignments.
  return { tags, selectedTags:requested, tagMode:mode, matchingPhotoIds:selectedIds };
}
