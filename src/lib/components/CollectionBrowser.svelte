<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { api, thumbUrl } from '$lib/client/api';
  import { dismissOnBackdrop } from '$lib/client/dialog-backdrop';
  import { compareCollectionNames } from '$shared/collection-order';
  import PreviewFrame from './PreviewFrame.svelte';

  type Photo = { id:number; displayName:string; renditionHash:string|null; renditionStatus:string };
  type Collection = { key:string; id?:number; name:string; draftPhotos?:Photo[] };
  let { eventId, collections, initialKey, selectedCount=0, assigned=()=>false, onadd, onclose }:
    { eventId:number; collections:Collection[]; initialKey:string; selectedCount?:number;
      assigned?:(key:string)=>boolean; onadd?:(key:string)=>void; onclose:()=>void } = $props();
  let dialog:HTMLDialogElement, preview:HTMLDialogElement;
  let key=$state(untrack(()=>initialKey));
  const ordered=$derived([...collections].sort(compareCollectionNames));
  const collection=$derived(ordered.find(c=>c.key===key));
  let photos=$state<Photo[]>([]), loading=$state(false), message=$state('');
  let controller:AbortController|undefined;
  let previewId=$state<number|null>(null);
  const current=$derived(photos.find(p=>p.id===previewId));
  const index=$derived(photos.findIndex(p=>p.id===previewId));
  function step(direction:number){if(photos.length&&index>=0)previewId=photos[(index+direction+photos.length)%photos.length].id;}
  function openPhoto(photo:Photo){previewId=photo.id;preview.showModal();}
  async function loadPhotos(){
    controller?.abort();const request=new AbortController();controller=request;
    photos=[];message='';previewId=null;
    if(!collection){loading=false;return;}
    if(!collection.id){photos=collection.draftPhotos??[];loading=false;return;}
    loading=true;
    try {
      const result=await api<{photos:Photo[]}>(`/admin/api/events/${eventId}/photos?gallery=${collection.id}`,{signal:request.signal,cache:'no-store'});
      if(!request.signal.aborted)photos=result.photos;
    } catch(error){if(!request.signal.aborted)message=error instanceof Error?error.message:'Could not load this collection.';}
    finally{if(!request.signal.aborted)loading=false;}
  }
  onMount(()=>{dialog.showModal();void loadPhotos();});
  onDestroy(()=>controller?.abort());
</script>

<dialog bind:this={dialog} use:dismissOnBackdrop aria-label="Browse collections" onclose={onclose} class="fixed inset-0 m-auto max-h-[92dvh] w-[min(1040px,94vw)] overflow-auto rounded-2xl border-0 bg-stone-50 p-4 shadow-xl backdrop:bg-black/65 sm:p-6">
  <header class="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-stone-50 pb-4">
    <label class="min-w-0 flex-1"><span class="sr-only">Collection to browse</span><select aria-label="Collection to browse" bind:value={key} onchange={loadPhotos} class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold">{#each ordered as c(c.key)}<option value={c.key}>{c.name}{c.id?'':' · new'}</option>{/each}</select></label>
    <button type="button" class="button-secondary" onclick={()=>dialog.close()}>Back to {onadd?'sorting':'photos'}</button>
  </header>
  {#if loading}<p role="status" class="py-12 text-center text-sm text-stone-500">Loading photos…</p>
  {:else if message}<div role="alert" class="rounded-xl bg-red-50 p-4 text-sm text-red-900">{message}<button type="button" class="ml-3 underline" onclick={loadPhotos}>Retry</button></div>
  {:else}
    <p class="mb-3 text-xs text-stone-500">{photos.length} photo{photos.length===1?'':'s'}{collection?.id?'':' · unsaved collection'}</p>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {#each photos as photo(photo.id)}<button type="button" aria-label={`View existing photo ${photo.displayName}`} onclick={()=>openPhoto(photo)} class="overflow-hidden rounded-xl border border-stone-200 bg-white text-left">
        {#if photo.renditionStatus==='ready'}<img src={thumbUrl(photo.id,photo.renditionHash)} alt={photo.displayName} class="aspect-[4/3] w-full object-contain bg-stone-100" loading="lazy" decoding="async" />{:else}<span class="flex aspect-[4/3] items-center justify-center bg-stone-100 text-xs text-stone-500">Preview processing</span>{/if}
        <span class="block truncate p-2 text-xs">{photo.displayName}</span>
      </button>{/each}
    </div>
    {#if !photos.length}<p class="py-12 text-center text-sm text-stone-500">No photos in this collection yet.</p>{/if}
  {/if}
  {#if onadd}<footer class="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 pt-4">
    <span class="text-xs text-stone-500">{selectedCount} batch photo{selectedCount===1?'':'s'} selected</span>
    <button type="button" class="button-primary" disabled={loading||!!message||!collection||!selectedCount||assigned(key)} onclick={()=>onadd?.(key)}>{assigned(key)?'✓ Added to batch':`Add ${selectedCount} selected photo${selectedCount===1?'':'s'} here`}</button>
  </footer>{/if}
</dialog>

<dialog bind:this={preview} use:dismissOnBackdrop aria-label="Existing collection photo" onclose={()=>previewId=null} class="fixed inset-0 m-auto max-h-[92dvh] w-[min(1000px,94vw)] overflow-auto rounded-2xl border-0 bg-white p-4 shadow-xl backdrop:bg-black/70">
  <header class="mb-3 flex items-center justify-between gap-3"><strong class="text-sm">{current?.displayName}</strong><button type="button" class="button-secondary" onclick={()=>preview.close()}>Back to collection</button></header>
  {#if current}<PreviewFrame {index} total={photos.length} items={photos.map(p=>({id:p.id,label:p.displayName,thumb:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash):undefined,preview:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash,'preview'):undefined}))} onselect={id=>previewId=Number(id)} onprevious={()=>step(-1)} onnext={()=>step(1)}>{#if current.renditionStatus==='ready'}<img src={thumbUrl(current.id,current.renditionHash,'preview')} alt={current.displayName} class="max-h-[70dvh] w-full object-contain" />{:else}<p class="p-8 text-center text-sm text-stone-500">A preview is not ready yet.</p>{/if}</PreviewFrame>{/if}
</dialog>
