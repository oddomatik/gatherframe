<script lang="ts">
  import { dismissOnBackdrop } from '$lib/client/dialog-backdrop';
  import PreviewFrame from './PreviewFrame.svelte';
  import CollectionBrowser from './CollectionBrowser.svelte';
  import { compareCollectionNames } from '$shared/collection-order';
  import {selectPhoto,selectionModifiers,preventRangeTextSelection} from '$lib/client/photo-selection';
  import { onMount, untrack, tick } from 'svelte';
  import { beforeNavigate, invalidateAll } from '$app/navigation';
  import {readDraft,writeDraft,draftKey,DraftConflict,type DraftRecord,type SortingDraft} from '$lib/client/sorting-drafts';
  import { api, thumbUrl, ApiError } from '$lib/client/api';
  import { clientUuid } from '$lib/client/ids';
  type Photo = {id:number;displayName:string;renditionHash:string|null;renditionStatus:string;collections:{id:number;name:string;isIntake:number}[]};
  type Gallery = {id:number;name:string;isIntake:number;coverThumbId:number|null;coverHash:string|null};
  type Target = {key:string;id?:number;name:string;photoIds:number[];coverId:number|null;coverHash:string|null};
  let { eventId, actorId, initial, photos, galleries, onfinish, oncancel }: {eventId:number;actorId:number;initial?:DraftRecord;photos:Photo[];galleries:Gallery[];onfinish:(count:number)=>void;oncancel:()=>void} = $props();
  let dialog: HTMLDialogElement;
  let collectionPanel: HTMLElement;
  let photoPanel: HTMLElement;
  let closer: HTMLDialogElement;
  let closePhotoId=$state<number|null>(null);
  const closePhoto=$derived(photos.find(p=>p.id===closePhotoId)??null);
  const closeIndex = $derived(photos.findIndex(p => p.id === closePhoto?.id));
  function stepCloser(direction: number) { if (photos.length && closeIndex >= 0) closePhotoId = photos[(closeIndex + direction + photos.length) % photos.length].id; }
  function lookCloser(photo:Photo){closePhotoId=photo.id;closer.showModal();}
  let active = $state<number[]>(untrack(() => photos.map(p => p.id)));
  let selectionMode=$state(false);
  let targets = $state<Target[]>(untrack(() => galleries.filter(g=>!g.isIntake).map(g=>({key:`id-${g.id}`,id:g.id,name:g.name,photoIds:[],coverId:g.coverThumbId,coverHash:g.coverHash}))));
  let selectionAnchor=$state<number|null>(null);
  let browsingKey=$state<string|null>(null);
  let newName = $state(''); let search = $state(''); let saving = $state(false); let message = $state('');
  const hasChanges = $derived(targets.some(t=>t.photoIds.length));
  const planned = $derived(new Set(targets.flatMap(t=>t.photoIds)).size);
  const orderedTargets = $derived([...targets].sort(compareCollectionNames));
  const visibleTargets = $derived(orderedTargets.filter(t=>t.name.toLowerCase().includes(search.toLowerCase())));
  const browsableTargets = $derived(orderedTargets.map(t=>({key:t.key,id:t.id,name:t.name,draftPhotos:photos.filter(p=>belongs(p.id,t))})));
  function assigned(key:string){const target=targets.find(t=>t.key===key);return !!target&&active.length>0&&matching(target)===active.length;}
  function addFromBrowser(key:string){const target=targets.find(t=>t.key===key);if(target&&!assigned(key))choose(target);}
  const readyCount = $derived(photos.filter(p=>targets.some(t=>belongs(p.id,t))).length);
  const remaining = $derived(photos.length-readyCount);
  function alreadyIn(photoId:number,t:Target) { return !!t.id && !!photos.find(p=>p.id===photoId)?.collections.some(g=>!g.isIntake&&g.id===t.id); }
  function belongs(photoId:number,t:Target) { return alreadyIn(photoId,t)||t.photoIds.includes(photoId); }
  function matching(t:Target) { return active.filter(id=>belongs(id,t)).length; }
  function togglePhoto(id:number,event:MouseEvent & {pointerType?:string}) {const next=selectPhoto(active,photos.map(p=>p.id),selectionAnchor,id,selectionModifiers(event));active=next.selected;selectionAnchor=next.anchor;}
  function checkPhoto(id:number,event:MouseEvent & {pointerType?:string}){selectionMode=true;const next=selectPhoto(active,photos.map(p=>p.id),selectionAnchor,id,{...selectionModifiers(event),toggleOnly:true});active=next.selected;selectionAnchor=next.anchor;}
  function allPhotos(){selectionMode=true;active=photos.map(p=>p.id);selectionAnchor=null;}
  function noPhotos(){selectionMode=true;active=[];selectionAnchor=null;}
  function choose(t:Target) {
    if(locked||!active.length)return;
    if(matching(t)===active.length) t.photoIds=t.photoIds.filter(id=>!active.includes(id));
    else t.photoIds=[...new Set([...t.photoIds,...active.filter(id=>!alreadyIn(id,t))])];
    message='';
  }
  function create() {
    if(locked||!active.length)return;
    let name=newName.trim();
    if(!name){let n=1;while(targets.some(t=>t.name===`Collection ${String(n).padStart(3,'0')}`))n++;name=`Collection ${String(n).padStart(3,'0')}`;}
    if(name.length>120)return;
    const cover=photos.find(p=>active.includes(p.id)&&p.renditionStatus==='ready');
    targets.push({key:clientUuid(),name,photoIds:[...active],coverId:cover?.id??null,coverHash:cover?.renditionHash??null});
    newName='';search='';message='';
  }
  let ready=$state(false),baseline=$state(''),deviceStatus=$state('Preparing draft…'),deviceError=$state('');
  let pending=$state<SortingDraft['pending']>(),conflict=$state(false),frozen=$state(false);
  let localRevision=0,generation=0,acknowledged=0,closed=false;
  let writes:Promise<void>=Promise.resolve();
  const locked=$derived(saving||!ready||!!pending||frozen);
  function snapshot():SortingDraft{return {version:1,photoIds:photos.map(p=>p.id),active:[...active],targets:targets.map(t=>({...t,photoIds:[...t.photoIds]})),search,newName,selectionMode,baseline,pending:pending?JSON.parse(JSON.stringify(pending)):undefined,updatedAt:new Date().toISOString()};}
  function persist(draft:SortingDraft){
    if(closed||frozen)return;
    const mine=++generation;deviceStatus='Saving on device…';
    writes=writes.then(async()=>{if(closed||frozen)return;try{const record=await writeDraft(draftKey(actorId,eventId),localRevision,draft);localRevision=record.revision;acknowledged=mine;if(mine===generation){deviceStatus='Saved on this device';deviceError='';}}
    catch(err){if(err instanceof DraftConflict)frozen=true;deviceStatus='Not saved on device';deviceError=err instanceof DraftConflict?err.message:'Device storage unavailable or full. Keep this tab open; your edits are still in memory.';}});
  }
  $effect(()=>{if(ready){const draft=snapshot();untrack(()=>persist(draft));}});
  async function latestBaseline(){const state=await api<{revision:string}>(`/admin/api/events/${eventId}/organize/state`,{method:'POST',json:{photoIds:photos.map(p=>p.id)}});return state.revision;}
  async function reviewLatest(){if(!confirm('Keep these proposed assignments and review them against the latest collection state? Nothing will be submitted yet.'))return;try{await invalidateAll();await tick();for(const t of targets){if(!t.id)continue;const g=galleries.find(g=>g.id===t.id&&!g.isIntake);if(!g&&t.photoIds.length)throw new Error('A target collection is no longer available. Uncheck it before reviewing again.');if(g){t.name=g.name;t.coverId=g.coverThumbId;t.coverHash=g.coverHash;}}for(const g of galleries.filter(g=>!g.isIntake&&!targets.some(t=>t.id===g.id)))targets.push({key:`id-${g.id}`,id:g.id,name:g.name,photoIds:[],coverId:g.coverThumbId,coverHash:g.coverHash});baseline=await latestBaseline();conflict=false;message='Review the collection labels and staged assignments, then Save & finish.';}catch(e){message=e instanceof Error?e.message:'Could not check collections';}}
  async function cancel(){if(saving)return;await writes;if(acknowledged!==generation&&!confirm('This draft is not saved on this device. Leave this window anyway?'))return;closed=true;dialog.close();oncancel();}
  async function discard(){if(saving||!confirm('Discard this sorting draft and its unsaved assignments?'))return;await writes;try{await writeDraft(draftKey(actorId,eventId),localRevision,null);closed=true;dialog.close();oncancel();}catch(e){deviceError=e instanceof Error?e.message:'Could not discard draft';}}
  async function save(){
    if(saving||!ready||frozen||conflict||!hasChanges)return;
    if(!pending){const plan=targets.filter(t=>t.photoIds.length).map(t=>t.id?{kind:'existing',galleryId:t.id,photoIds:t.photoIds}:{kind:'new',key:t.key,label:t.name,photoIds:t.photoIds});pending={requestId:clientUuid(),revision:baseline,photoIds:photos.map(p=>p.id),targets:plan};persist(snapshot());}
    saving=true;message='';await writes;if(frozen){saving=false;return;}
    try{const result=await api<{photos:number}>(`/admin/api/events/${eventId}/organize`,{method:'POST',json:pending});closed=true;
      try{await writeDraft(draftKey(actorId,eventId),localRevision,null);}catch{/* A stale local draft replays the same receipt, never another save. */}
      dialog.close();onfinish(result.photos);
    }catch(err){message=err instanceof Error?err.message:'Could not confirm save. Retry to confirm the same operation.';
      if(err instanceof ApiError && [400,409].includes(err.status)){pending=undefined;conflict=err.status===409;}
    }finally{saving=false;}
  }
  onMount(()=>{dialog.showModal();void (async()=>{try{
    let record:DraftRecord;try{record=initial??await readDraft(draftKey(actorId,eventId));}catch{record={key:draftKey(actorId,eventId),revision:0,draft:null};deviceError='Device storage unavailable. Keep this tab open; edits will be in memory only.';}localRevision=record.revision;
    if(record.draft&&!initial){frozen=true;deviceError='A saved draft already exists. Close and resume that draft first.';return;}
    if(record.draft){const d=record.draft;if(d.version!==1)throw new Error('This draft version is not supported.');active=d.active;targets=d.targets;search=d.search;newName=d.newName;selectionMode=d.selectionMode;baseline=d.baseline;pending=d.pending;
      for(const t of targets){const current=galleries.find(g=>g.id===t.id);if(current){t.name=current.name;t.coverId=current.coverThumbId;t.coverHash=current.coverHash;}}
      try{conflict=!pending&&await latestBaseline()!==baseline;}catch{message='Offline: device draft recovered. Reconnect before saving.';}
    }else baseline=await latestBaseline();ready=true;
   }catch(err){deviceError=err instanceof Error?err.message:'Could not prepare recovery';deviceStatus='Not saved on device';}})();});
  beforeNavigate(e=>{if(saving||(hasChanges&&!confirm('Leave this sorting batch? Only changes marked saved on this device can be recovered.')))e.cancel();});
</script>

{#if browsingKey}<CollectionBrowser {eventId} collections={browsableTargets} initialKey={browsingKey} selectedCount={active.length} {assigned} onadd={addFromBrowser} onclose={()=>browsingKey=null} />{/if}

<svelte:window onbeforeunload={e=>{if(hasChanges||saving){e.preventDefault();e.returnValue='';}}}/>
<dialog bind:this={dialog} aria-labelledby="organize-heading" oncancel={e=>{e.preventDefault();cancel();}} class="m-auto flex max-h-[95dvh] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-2xl border-0 bg-stone-50 p-0 shadow-xl backdrop:bg-black/65">
  <header class="shrink-0 border-b border-stone-200 bg-white p-4 sm:px-6"><div class="flex items-start gap-3"><div><h2 id="organize-heading" class="text-xl font-semibold">Organize photos</h2><p class="mt-1 text-sm text-stone-600">Add to one or more collections.</p></div><button type="button" onclick={cancel} disabled={saving} aria-label="Close sorting window" class="ml-auto rounded-lg border border-stone-300 px-3 py-2 text-sm">Close</button></div></header>
  <div class="min-h-0 overflow-y-auto p-4 sm:p-6">
    <div class="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <section bind:this={photoPanel} aria-label="Photos in this sorting batch" class="min-w-0">
        <div class="mb-3 flex flex-wrap items-center gap-3"><h3 class="mr-auto text-sm font-semibold">{active.length} of {photos.length} selected</h3><button type="button" disabled={locked} onclick={allPhotos} class="text-xs underline">Select all in batch</button><button type="button" disabled={locked} onclick={noPhotos} class="text-xs underline">Select none in batch</button></div>
        <div class="mb-3 flex flex-wrap items-center gap-3"><button type="button" disabled={locked} aria-pressed={selectionMode} class={selectionMode?'button-primary':'button-secondary'} onclick={()=>selectionMode=!selectionMode}>{selectionMode?'Done selecting':'Select photos'}</button><details class="text-xs"><summary class="cursor-pointer py-3">Shortcuts</summary><p class="py-2">Shift: add range · Ctrl / ⌘: toggle</p></details></div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {#each photos as p (p.id)}
            <article class={`overflow-hidden rounded-xl border-2 bg-white ${active.includes(p.id)?'border-amber-500':'border-stone-200'}`} data-photo-id={p.id}>
              <div class="relative"><button type="button" disabled={locked} data-photo-select={p.id} onmousedown={e=>{if(selectionMode)preventRangeTextSelection(e);}} onclick={(e)=>selectionMode?togglePhoto(p.id,e):lookCloser(p)} aria-pressed={selectionMode?active.includes(p.id):undefined} aria-label={selectionMode?`Select batch photo ${p.displayName}`:`Open batch photo ${p.displayName}`} class="relative block w-full select-none bg-stone-100">
                {#if p.renditionStatus==='ready'}<img src={thumbUrl(p.id,p.renditionHash)} alt={p.displayName} draggable="false" class="aspect-[4/3] w-full object-contain" loading="lazy" decoding="async" />{:else}<span class="flex aspect-[4/3] items-center justify-center text-xs">Preview processing</span>{/if}
              </button><button type="button" disabled={locked} data-photo-check={p.id} aria-pressed={active.includes(p.id)} aria-label={`${active.includes(p.id)?'Deselect':'Select'} batch photo ${p.displayName}`} onmousedown={preventRangeTextSelection} onclick={e=>checkPhoto(p.id,e)} class="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-amber-600"><span class={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${active.includes(p.id)?'border-amber-500 bg-amber-500 text-white':'border-white bg-black/35 text-white/70'}`}>✓</span></button></div>
              <div class="p-2"><p class="truncate text-xs font-medium" title={p.displayName}>{p.displayName}</p><div class="mt-2 flex flex-wrap gap-1">
                {#each orderedTargets.filter(t=>belongs(p.id,t)) as t (t.key)}<span class="max-w-full break-words rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-950">{t.name}{!alreadyIn(p.id,t) ? ' · to add' : ''}</span>{/each}
                {#if !targets.some(t=>belongs(p.id,t))}<span class="text-[11px] text-stone-500">Still needs a collection</span>{/if}
              </div></div>
            </article>
          {/each}
        </div>
      </section>
      <section bind:this={collectionPanel} aria-label="Choose collections" class="order-first rounded-xl border border-stone-200 bg-white p-4 lg:sticky lg:top-0 lg:order-last">
        <div class="flex items-center justify-between gap-2"><h3 class="text-sm font-semibold">Add to collections</h3>{#if visibleTargets.length}<button type="button" class="text-xs underline" disabled={locked} onclick={()=>browsingKey=visibleTargets[0].key}>Browse</button>{/if}</div>
        <p class="mt-1 text-xs text-stone-600">For {active.length} selected photo{active.length===1?'':'s'}.</p>
        <button type="button" class="mt-2 text-xs underline lg:hidden" onclick={()=>photoPanel.scrollIntoView({block:'start'})}>Choose a different subset of photos ↓</button>
        <form class="mt-3 rounded-lg bg-amber-50 p-3" onsubmit={e=>{e.preventDefault();create();}}>
          <label for="new-child-collection" class="text-xs font-semibold">New collection</label>
          <input id="new-child-collection" bind:value={newName} maxlength="120" disabled={locked} placeholder="Name optional — e.g. Collection 001" class="mt-1 w-full min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" />
          <button disabled={locked||!active.length} class="mt-2 w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">+ Create & assign selected</button>
          <p class="mt-2 text-[11px] text-stone-600">Blank name → Collection 001, Collection 002…</p>
        </form>
        {#if targets.length>6}<input type="search" aria-label="Find collection" bind:value={search} placeholder="Find collection…" class="mt-3 w-full rounded-lg border border-stone-300 p-2 text-sm" />{/if}
        <div class="mt-3 max-h-[45dvh] space-y-2 overflow-y-auto">
          {#each visibleTargets as t (t.key)}
            {@const n=matching(t)}
            <div class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-2 text-xs">
              <button type="button" aria-label={`View photos in ${t.name}`} disabled={locked} onclick={()=>browsingKey=t.key} class="w-24 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                {#if t.coverId}<img src={thumbUrl(t.coverId,t.coverHash)} alt="" class="h-24 w-24 object-contain" loading="lazy" />{:else}<span class="flex h-24 items-center justify-center text-stone-400" aria-hidden="true">▦</span>{/if}
                <span class="block bg-white py-2 underline">View photos</span>
              </button>
              <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 py-3"><input type="checkbox" aria-label={`Assign ${t.name}`} checked={active.length>0&&n===active.length} indeterminate={n>0&&n<active.length} disabled={locked||!active.length} onchange={()=>choose(t)} /><span class="min-w-0 break-words font-semibold">{t.name}<small class="mt-1 block font-normal text-stone-500">{n} of {active.length} selected here{t.id?'':' · new'}</small></span></label>
            </div>
          {/each}
        </div>
        {#if !targets.length}<p class="mt-3 text-xs text-stone-500">Create your first collection above.</p>{/if}
        {#if hasChanges}<p class="mt-3 text-xs text-stone-500">Unsaved changes</p>{/if}
      </section>
    </div>
  </div>
  <footer class="shrink-0 border-t border-stone-200 bg-white p-4 sm:px-6">
    <div class="mb-2 flex flex-wrap items-center gap-3 text-xs"><span role="status">{deviceStatus}</span><button class="underline" disabled={saving||frozen} onclick={()=>persist(snapshot())}>Retry device save</button><button class="underline" disabled={saving} onclick={discard}>Discard draft</button></div>
    {#if deviceError}<p role="alert" class="mb-2 text-sm text-amber-900">{deviceError}</p>{/if}
    {#if conflict}<p class="mb-2 text-sm text-amber-900">Collections changed since this draft began. <button class="underline" onclick={reviewLatest}>Review latest state</button></p>{/if}
    {#if pending&&!saving}<p class="mb-2 text-sm">A save needs confirmation. Retry Save & finish before changing assignments.</p>{/if}
    {#if message}<p role="alert" class="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>{/if}
    <div class="flex flex-wrap items-center gap-3"><p class="mr-auto text-xs text-stone-600">{planned} photo{planned===1?'':'s'} with new assignments.{#if remaining} {remaining} still need a collection and will stay in To sort.{/if}</p><button type="button" class="rounded-lg border border-stone-300 px-3 py-2 text-xs lg:hidden" onclick={()=>collectionPanel.scrollIntoView({block:'start'})}>Choose collections ↑</button><button type="button" onclick={save} disabled={saving||!ready||frozen||conflict||!hasChanges} class="rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{saving?'Saving…':'Save & finish'}</button></div>
  </footer>
</dialog>

<dialog bind:this={closer} use:dismissOnBackdrop aria-label="Closer look at batch photo" onclose={()=>closePhotoId=null} class="fixed inset-0 m-auto max-h-[92dvh] w-[min(1000px,94vw)] overflow-auto rounded-2xl bg-white p-4 shadow-xl backdrop:bg-black/70">
  <div class="mb-3 flex items-center justify-between gap-3"><strong class="text-sm">{closePhoto?.displayName}</strong><button type="button" class="button-secondary" onclick={()=>closer.close()}>Back to sorting</button></div>
  {#if closePhoto}<PreviewFrame index={closeIndex} total={photos.length} items={photos.map(p=>({id:p.id,label:p.displayName,thumb:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash):undefined,preview:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash,'preview'):undefined}))} onselect={id=>closePhotoId=Number(id)} onprevious={()=>stepCloser(-1)} onnext={()=>stepCloser(1)}>{#if closePhoto.renditionStatus==='ready'}<img src={thumbUrl(closePhoto.id,closePhoto.renditionHash,'preview')} alt={closePhoto.displayName} class="max-h-[70dvh] w-full object-contain" decoding="async" />{:else}<p class="p-8 text-center text-sm text-stone-500">A preview is not ready yet.</p>{/if}</PreviewFrame>{/if}
</dialog>
