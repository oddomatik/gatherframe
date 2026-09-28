import { createHash } from 'node:crypto';
import { sqlite } from './db';

/** A small, private change probe; neither filenames nor original bytes travel with it. */
export function photoRevision(eventId: number): string {
  const rows = sqlite.prepare(`SELECT p.id, p.updated_at, p.rendition_status, p.rendition_hash
    FROM photos p JOIN galleries g ON g.id=p.gallery_id
    WHERE g.event_id=? ORDER BY p.id`).all(eventId);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
