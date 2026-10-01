import { listDeliveryVersions, fileIsCurrent, deliveryFilename } from './delivery';
import type { PhotoWithFiles, GalleryTile } from './events';
import type { Event } from './db/schema';
import { sqlite } from './db';
import { mediaUrl } from './media-access';
import { comparePhotoOrder } from '$shared/photo-order';
import { activeCollectionCounts, chooseCollectionCover } from './collection-covers';

export interface PublicFile { id: number; role: string; label: string; bytes: number; ext: string; originalFilename: string; width: number | null; height: number | null; downloadable: boolean; }
export interface PublicPhoto { id: number; stem: string; displayName: string; shootDay: number | null; width: number | null; height: number | null; hash: string | null; ready: boolean; urls: { thumb: string; preview: string; web: string }; shareUrl: string; files: PublicFile[]; }
export interface PublicDayCounts { all: number; day1: number; day2: number; unassigned: number; }

/** Count photos, not collection memberships: a friends photo is still one moment. */
export function publicDayCounts(event: Event): PublicDayCounts {
  return sqlite.prepare(`SELECT count(*) AS "all", coalesce(sum(shoot_day = 1), 0) AS day1,
    coalesce(sum(shoot_day = 2), 0) AS day2, coalesce(sum(shoot_day IS NULL), 0) AS unassigned
    FROM photos p WHERE p.rendition_status = 'ready' AND EXISTS (
      SELECT 1 FROM gallery_photos gp JOIN galleries g ON g.id = gp.gallery_id
      WHERE gp.photo_id = p.id AND g.event_id = ? AND g.is_archived = 0 AND g.is_intake = 0
    )`).get(event.id) as PublicDayCounts;
}

/** Strip server-only fields and apply the event's variant policy (disabled roles are not offered). */
export function publicPhotos(rows: PhotoWithFiles[], policy: Record<string, 'free' | 'disabled' | 'paid'>, event: Event): PublicPhoto[] {
  const versions = new Map(listDeliveryVersions(event.id).map(v => [v.key, v]));
  return rows.filter((p) => p.renditionStatus === 'ready').map((p) => ({
    id: p.id, stem: `photo-${p.id}`, displayName: `Photo ${p.id}`, shootDay: p.shootDay ?? null, width: p.width, height: p.height, hash: p.renditionHash, ready: true,
    urls: { thumb: mediaUrl(event, p.id, 'thumb', p.renditionHash), preview: mediaUrl(event, p.id, 'preview', p.renditionHash), web: mediaUrl(event, p.id, 'web', p.renditionHash) },
    shareUrl: `/g/${event.slug}/p/${p.id}`,
    files: p.files.filter((f) => versions.has(f.role) && ['free','paid'].includes(policy[f.role]) && fileIsCurrent(f)).map((f) => ({
      id: f.id, role: f.role, label: versions.get(f.role)!.label, bytes: f.bytes, ext: f.ext, originalFilename: deliveryFilename({...f, photoId: p.id}, versions.get(f.role)), width: f.width, height: f.height,
      downloadable: !!f.downloadable && policy[f.role] === 'free'
    }))
  }));
}

/** Private organization labels never leave the photographer workspace. */
export function publicGalleries(rows: GalleryTile[], event: Event, shootDay: 1 | 2 | null = null, matchingIds?: Set<number>) {
  const counts = activeCollectionCounts(event.id);
  return rows.filter((g) => !g.isArchived && !g.isIntake).flatMap((g) => {
    const photos = (sqlite.prepare(`SELECT p.id, p.stem, p.sort_order AS sortOrder, p.rendition_hash AS hash FROM photos p
      JOIN gallery_photos gp ON gp.photo_id = p.id WHERE gp.gallery_id = ? AND p.rendition_status = 'ready'
      ${shootDay === null ? '' : 'AND p.shoot_day = ?'} ORDER BY p.sort_order, p.id`)
      .all(...(shootDay === null ? [g.id] : [g.id, shootDay])) as { id: number; stem: string; sortOrder: number; hash: string | null }[]).filter(p => !matchingIds || matchingIds.has(p.id)).sort(comparePhotoOrder);
    if (!photos.length) return [];
    const cover = chooseCollectionCover(photos, g.coverPhotoId, event.collectionCoverPolicy ?? 'exclusive', counts)!;
    return [{ id: g.id, publicId: g.publicId, photoIds: photos.map(p=>p.id), photoCount: photos.length, coverThumbId: cover.id, coverHash: cover.hash,
      coverUrl: mediaUrl(event, cover.id, 'cover640', cover.hash) }];
  });
}
