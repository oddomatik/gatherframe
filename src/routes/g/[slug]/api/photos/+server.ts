import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireEventAccess } from '$server/guard';
import { getGalleryByPublicId, listPhotos } from '$server/events';
import { publicPhotos, publicGalleries } from '$server/public';

export const GET: RequestHandler = (e) => {
  const { event } = requireEventAccess(e);
  const pid = e.url.searchParams.get('g') ?? '';
  const gallery = getGalleryByPublicId(event.id, pid);
  if (!gallery || gallery.isArchived || gallery.isIntake) throw error(404, 'Not found');
  return json({ gallery: { id: gallery.id, publicId: gallery.publicId, name: gallery.publicTitle ?? '', description:gallery.publicDescription }, photos: publicPhotos(listPhotos(gallery.id), event.variantPolicy, event) });
};
