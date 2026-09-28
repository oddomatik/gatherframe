import type { PageServerLoad } from './$types';
import { mediaUrl } from '$server/media-access';
import { publicLinkPreview } from '$server/link-preview';
import { eventContext } from '$server/guard';
import { browseTags, emptyTagBrowse, visibleEventPhotos } from '$server/tag-browsing';
export const load: PageServerLoad = (e) => {
  const { event, state } = eventContext(e);
  if (state !== 'ok') return { ...emptyTagBrowse, galleries:[], heroUrl:null, heroSmallUrl:null, heroLargeUrl:null, heroWidth:null, heroHeight:null, photoCount:0 };
  const result = browseTags(event,e.url.searchParams,visibleEventPhotos(event));
  const selected = result.photos.find(p => p.id === event.sharePhotoId && result.matchingPhotoIds.includes(p.id));
  const heroUrl = (selected ? mediaUrl(event, selected.id, 'cover960', selected.hash) : null) ?? (event.shareUploadHash && !result.selectedTags.length ? publicLinkPreview(event).imageUrl : null);
  return { ...result, photos:[], galleries:result.siblings, heroUrl, heroSmallUrl: selected ? mediaUrl(event, selected.id, 'cover640', selected.hash) : null, heroLargeUrl: selected ? mediaUrl(event, selected.id, 'cover1440', selected.hash) : null, heroWidth:selected ? selected.width : (heroUrl ? 1200 : null), heroHeight:selected ? selected.height : (heroUrl ? 630 : null), photoCount:result.matchingPhotoIds.length };
};
