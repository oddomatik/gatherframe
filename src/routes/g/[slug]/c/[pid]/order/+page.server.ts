import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { getGalleryByPublicId, listGalleries, listPhotos } from '$server/events';
import { publicPhotos, publicGalleries } from '$server/public';
import { eventCatalog } from '$server/catalog';
import { getSettings } from '$server/settings';

export const load: PageServerLoad = (e) => {
  const { event, state } = eventContext(e);
  if (state !== 'ok') return { gallery: null, photos: [], siblings: [], catalog: null, initialPhotoId: null, venmoHandle: '', fromFavorites: false, emailUpdatesAvailable: false };
  if (!event.orderingEnabled) throw redirect(302, `/g/${event.slug}/c/${e.params.pid}`);
  const gallery = getGalleryByPublicId(event.id, e.params.pid);
  if (!gallery || gallery.isArchived || gallery.isIntake) throw error(404, 'Not found');
  const { catalog } = eventCatalog(event.id, event.catalogId);
  const siblings = publicGalleries(listGalleries(event.id), event);
  const initial = Number(e.url.searchParams.get('photo'));
  return {
    gallery: { id: gallery.id, publicId: gallery.publicId, name: '' },
    photos: publicPhotos(listPhotos(gallery.id), event.variantPolicy, event),
    siblings, catalog, initialPhotoId: Number.isFinite(initial) && initial > 0 ? initial : null,
    venmoHandle: getSettings().venmoHandle, fromFavorites: e.url.searchParams.get('favorites') === '1', emailUpdatesAvailable: Boolean(getSettings().smtp?.host)
  };
};
