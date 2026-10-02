import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { publicTagData } from '$server/tags';
import { visibleEventPhotos } from '$server/tag-browsing';
import { listTags } from '$server/tags';
import { tagIsShared, tagQuery } from '$shared/tags';
export const load: PageServerLoad = e => {
  const {event,state} = eventContext(e);
  if (state !== 'ok') return {};
  const tags=listTags(event.id), tag=tags.find(t=>t.publicId===e.params.tagId);
  if (!tag || !tagIsShared(tags,tag.id) || (event.guestGrant && !publicTagData(event.id,visibleEventPhotos(event).map(p=>p.id),new URLSearchParams()).tags.some(t=>t.id===tag.id))) throw error(404,'This tag is not shared.');
  throw redirect(303,`/g/${event.slug}/browse${tagQuery([tag.publicId])}`);
};
