<script lang="ts">
  import { activity } from '$lib/client/activity';
  import { untrack } from 'svelte';
  import BottomSheet from './BottomSheet.svelte';
  import PreviewFrame from './PreviewFrame.svelte';
  import { photoUrl, photoShareUrl, sharePhoto, type PhotoPresentation } from '$lib/client/photos';
  interface Props { photos?: PhotoPresentation[]; onselect?: (id:number)=>void; photo: PhotoPresentation | null; slug: string; position?: string; index?: number; total?: number; onclose: () => void; ondownload?: () => void; onchoose?: () => void; onprevious?: () => void; onnext?: () => void; favorite?: boolean; onfavorite?: () => void; }
  let { photo, slug, position = 'Photo preview', photos = [], onselect, index = -1, total = 0, onclose, ondownload, onchoose, onprevious, onnext, favorite = false, onfavorite }: Props = $props();
  let lastViewed: number | null = null;
  $effect(()=>{const id=photo?.id??null;if(id!==lastViewed){lastViewed=id;if(id)untrack(()=>activity(slug,'photo_view',{photoId:id}));}});
</script>
<BottomSheet open={!!photo} title={position} {onclose} wide centered>
  {#if photo}
    <PreviewFrame {index} {total} items={photos.map(p=>({id:p.id,label:`Photo ${p.id}`,thumb:photoUrl(p,'thumb'),preview:photoUrl(p,'web')}))} onselect={onselect?id=>onselect?.(Number(id)):undefined} {onprevious} {onnext}>
    <div class="relative overflow-hidden rounded-xl bg-stone-100">
      <img src={photoUrl(photo, 'web')} alt="Enlarged preview" class="mx-auto max-h-[60dvh] w-full object-contain" />
    </div>
    </PreviewFrame>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#if onfavorite}<button type="button" class="button-secondary" aria-pressed={favorite} onclick={onfavorite}>{favorite ? '♥ Saved' : '♡ Favorite'}</button>{/if}
      <button type="button" class="button-secondary" onclick={() => sharePhoto(photo!, slug)}>Share photo</button>
      <a href={photoShareUrl(photo, slug)} class="text-xs underline" target="_blank" rel="noopener">Open link</a>
      {#if onchoose}<button type="button" class="button-primary ml-auto" onclick={onchoose}>Use this photo</button>{/if}
      {#if ondownload}<button type="button" class="button-primary ml-auto" onclick={ondownload}>Download photo</button>{/if}
    </div>
  {/if}
</BottomSheet>
