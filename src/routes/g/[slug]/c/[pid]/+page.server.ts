import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { getGalleryByPublicId, listPhotos } from '$server/events';
import { browseTags, emptyTagBrowse } from '$server/tag-browsing';
export const load: PageServerLoad = (e) => {
  const { event, state } = eventContext(e);
  if (state !== 'ok') return { gallery:null, ...emptyTagBrowse };
  const gallery = getGalleryByPublicId(event.id,e.params.pid);
  if (!gallery || gallery.isArchived || gallery.isIntake) throw error(404,'Not found');
  return { gallery:{id:gallery.id,publicId:gallery.publicId,name:gallery.publicTitle ?? '',description:gallery.publicDescription}, ...browseTags(event,e.url.searchParams,listPhotos(gallery.id)) };
};
