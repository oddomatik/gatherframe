import type { PageServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { browseTags, emptyTagBrowse, visibleEventPhotos } from '$server/tag-browsing';
export const load: PageServerLoad = (e) => {
  const {event,state} = eventContext(e);
  if (state !== 'ok') return { gallery:null,...emptyTagBrowse };
  return {gallery:{id:0,publicId:'',name:'Explore the moments',description:null},...browseTags(event,e.url.searchParams,visibleEventPhotos(event))};
};
