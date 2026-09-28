import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sqlite } from './db';
import { addPhotosToCollections, GroupingError } from './grouping';
import { nowIso } from './env';

const id = z.number().int().positive().safe();
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), galleryId: id, photoIds: z.array(id).min(1).max(5000) }).strict(),
  z.object({ kind: z.literal('new'), key: z.string().regex(/^[a-zA-Z0-9_-]{12,80}$/), label: z.string().trim().min(1).max(120), photoIds: z.array(id).min(1).max(5000) }).strict()
]);
const planSchema = z.object({ targets: z.array(target).min(1).max(200) }).strict();

/** One commit for a mixed solo/friends selection. New collection keys make an
 * identical retry safe even if the browser missed the successful response. */
export function saveOrganization(eventId: number, input: unknown) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new GroupingError('Choose photos and at least one named collection. Nothing was changed.');
  const targets = parsed.data.targets;
  const ids = [...new Set(targets.flatMap(t => t.photoIds))];
  if (ids.length > 5000) throw new GroupingError('Choose at most 5,000 photos at once.');
  const keys = targets.map(t => t.kind === 'existing' ? `id:${t.galleryId}` : `key:${t.key}`);
  if (new Set(keys).size !== keys.length) throw new GroupingError('A collection is listed twice. Nothing was changed.');
  return sqlite.transaction(() => {
    const valid = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=? AND g.event_id=?');
    for (const photoId of ids) if (!valid.get(photoId, eventId)) throw new GroupingError('A selected photo is no longer in this event. Nothing was changed.');
    const saved = targets.map(t => {
      if (t.kind === 'existing') return { id: t.galleryId, photos: t.photoIds };
      const publicId = 'sort-' + createHash('sha256').update(`${eventId}:${t.key}`).digest('hex').slice(0, 24);
      const existing = sqlite.prepare('SELECT id,event_id,name,is_archived,is_intake FROM galleries WHERE public_id=?').get(publicId) as {id:number;event_id:number;name:string;is_archived:number;is_intake:number}|undefined;
      if (existing) {
        if (existing.event_id !== eventId || existing.name !== t.label || existing.is_archived || existing.is_intake) throw new GroupingError('A collection changed since this batch began. Refresh before retrying; nothing was changed.');
        return { id: existing.id, photos: t.photoIds };
      }
      const order = (sqlite.prepare('SELECT coalesce(max(sort_order),0)+1 AS n FROM galleries WHERE event_id=?').get(eventId) as {n:number}).n;
      const result = sqlite.prepare('INSERT INTO galleries (event_id,public_id,name,sort_order,is_intake,is_archived,created_at) VALUES (?,?,?,?,0,0,?)').run(eventId,publicId,t.label,order,nowIso());
      return { id: Number(result.lastInsertRowid), photos: t.photoIds };
    });
    for (const t of saved) addPhotosToCollections(eventId, t.photos, [t.id]);
    return { photos: ids.length, collections: saved.length };
  })();
}
