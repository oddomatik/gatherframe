import { scopeAllowsCollection } from './sharing';
import { error } from '@sveltejs/kit';
import { listEventPhotos, listGalleries, type PhotoWithFiles } from './events';
import { publicGalleries, publicPhotos } from './public';
import { publicTagData } from './tags';
import type { Event } from './db/schema';
export function visibleEventPhotos(event: Event) {
  const galleries = new Set(listGalleries(event.id).filter(g => !g.isArchived && !g.isIntake && scopeAllowsCollection(event,g.id)).map(g => g.id));
  // A shared photo is visible if any active non-intake collection contains it.
  const ids = new Set((eventMemberships(event.id)).filter(r => galleries.has(r.galleryId)).map(r => r.photoId));
  return listEventPhotos(event.id).filter(p => ids.has(p.id) && p.renditionStatus === 'ready');
}
import { sqlite } from './db';
function eventMemberships(eventId: number) { return sqlite.prepare('SELECT gp.photo_id AS photoId,gp.gallery_id AS galleryId FROM gallery_photos gp JOIN galleries g ON g.id=gp.gallery_id WHERE g.event_id=?').all(eventId) as {photoId:number;galleryId:number}[]; }
export function browseTags(event: Event, params: URLSearchParams, rows: PhotoWithFiles[]) {
  const photos = publicPhotos(rows,event.variantPolicy,event);
  let filters;
  try {
    if(event.guestGrant) {
      const availableTags=publicTagData(event.id,visibleEventPhotos(event).map(p=>p.id),new URLSearchParams()).tags;
      const allowed=availableTags.map(t=>t.publicId);
      if(params.has('day')&&!availableTags.some(t=>t.legacyDay===Number(params.get('day'))))throw new Error('Unavailable day');
      if((params.get('tags')??'').split(',').filter(Boolean).some(id=>!allowed.includes(id)))throw new Error('Unavailable tag');
    }
    filters = publicTagData(event.id,photos.map(p => p.id),params);
  } catch { throw error(404,'This filter is not shared or no longer exists.'); }
  const siblings = publicGalleries(listGalleries(event.id),event,null,new Set(filters.matchingPhotoIds));
  return { photos, siblings, ...filters };
}
export const emptyTagBrowse = { photos:[], siblings:[], tags:[], selectedTags:[] as string[],tagMode:'any' as const,matchingPhotoIds:[] as number[] };
