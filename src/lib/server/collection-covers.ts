import { sqlite } from './db';
import { comparePhotoOrder } from '$shared/photo-order';

export type CoverPolicy = 'exclusive' | 'first';
type Candidate = { id: number; stem: string; sortOrder: number };

/** Tags/intake/archive membership is not another child's collection. Count before filtering. */
export function activeCollectionCounts(eventId: number): Map<number, number> {
  const rows = sqlite.prepare(`SELECT gp.photo_id AS id, count(*) AS count
    FROM gallery_photos gp JOIN galleries g ON g.id=gp.gallery_id
    WHERE g.event_id=? AND g.is_intake=0 AND g.is_archived=0 GROUP BY gp.photo_id`)
    .all(eventId) as { id: number; count: number }[];
  return new Map(rows.map(row => [row.id, row.count]));
}

/** Call with ready, authorized candidates from the requested collection/filter only. */
export function chooseCollectionCover<T extends Candidate>(candidates: T[], pinnedId: number | null,
  policy: CoverPolicy, counts: Map<number, number>): T | undefined {
  const pinned = candidates.find(photo => photo.id === pinnedId);
  if (pinned) return pinned;
  const sorted = [...candidates].sort(comparePhotoOrder);
  return (policy === 'exclusive' ? sorted.find(photo => counts.get(photo.id) === 1) : undefined) ?? sorted[0];
}
