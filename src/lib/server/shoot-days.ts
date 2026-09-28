import {listTags,legacyDayTag,changePhotoTags} from './tags';
import { sqlite } from './db';
import { parseShootDay } from '$shared/shoot-days';

/** A day belongs to the moment, not its collections or its upload date.
 * Validate the whole batch before writing so a stale or cross-event selection
 * cannot partially label the owner's photos. No file or publication changes. */
export function setPhotoShootDay(eventId: number, photoIds: number[], value: unknown): { count: number; day: 1 | 2 | null } {
  const day = parseShootDay(value);
  const ids = [...new Set(photoIds)];
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error('Event not found.');
  if (!ids.length || ids.length > 5000 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('Choose between 1 and 5,000 photos.');
  }
  return sqlite.transaction(() => {
    const belongs = sqlite.prepare('SELECT p.id FROM photos p JOIN galleries g ON g.id = p.gallery_id WHERE p.id = ? AND g.event_id = ?');
    for (const id of ids) {
      if (!belongs.get(id, eventId)) throw new Error('Every selected photo must belong to this event. Nothing was changed.');
    }
    const update = sqlite.prepare('UPDATE photos SET shoot_day = ? WHERE id = ?');
    for (const id of ids) update.run(day, id);
    const old=listTags(eventId).filter(t=>t.legacyDay!=null).map(t=>t.id);
    if(old.length) changePhotoTags(eventId,ids,old,'remove');
    if(day) changePhotoTags(eventId,ids,[legacyDayTag(eventId,day)],'add');
    return { count: ids.length, day };
  })();
}
