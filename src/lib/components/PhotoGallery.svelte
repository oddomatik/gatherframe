<script lang="ts">
  import { activity } from '$lib/client/activity';
  import { api, formatBytes, isInAppBrowser, triggerDownload } from '$lib/client/api';
  import { photoUrl, photoShareUrl, sharePhoto, loadFavorites, saveFavorites } from '$lib/client/photos';
  import { toast } from '$lib/client/toast.svelte';
  import PhoneSave from './PhoneSave.svelte';
  import FamilyVisit from './FamilyVisit.svelte';
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import PhotoPreview from '$lib/components/PhotoPreview.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PublicTags from '$lib/components/PublicTags.svelte';
  import {tagQuery} from '$shared/tags';
  import type {PageData} from '../../routes/g/[slug]/c/[pid]/$types';
  let { data }: {data:PageData} = $props();
  let selected = $state<Set<number>>(new Set());
  let favorites = $state<Set<number>>(new Set());
  let favoritesOnly = $state(false);
  let sheetOpen = $state(false);
  let sheetPhotoIds = $state<number[]>([]);
  let roles = $state<Record<string, boolean>>({ social: false, print: true, raw: false });
  let busy = $state(false);
  let inApp = $state(false);
  let downloadStarted = $state(false);
  let downloadError = $state('');
  let previewId = $state<number | null>(null);
  let observedLink = '';
  onMount(() => { inApp = isInAppBrowser(); });
  $effect(() => { favorites = loadFavorites(data.event.id); });
  $effect(() => {
    const key = page.url.pathname + page.url.search;
    if (key !== observedLink) { if (observedLink.split('?')[0] !== page.url.pathname) { selected = new Set(); favoritesOnly = page.url.searchParams.get('favorites')==='1'; sheetOpen = false; } observedLink = key; const id = Number(page.url.searchParams.get('photo')); previewId = data.photos.some(p => p.id === id) ? id : null; }
  });
  const filtered=$derived(data.selectedTags.length>0);
  const filteredPhotos=$derived(data.photos.filter(p=>data.matchingPhotoIds.includes(p.id)));
  const visible=$derived(favoritesOnly?filteredPhotos.filter(p=>favorites.has(p.id)):filteredPhotos);
  const previewPhoto = $derived(data.photos.find(p => p.id === previewId) ?? null);
  const localFavorites = $derived(filteredPhotos.filter(p => favorites.has(p.id)).length);
  const selectedHidden=$derived(data.photos.filter(p=>selected.has(p.id)&&!visible.some(v=>v.id===p.id)).length);
  const previewIndex = $derived(visible.findIndex(p => p.id === previewId));
  const orderingCollection = $derived(data.gallery?.publicId || data.siblings[0]?.publicId);
  const otherCollections = $derived(data.siblings.filter(g => g.publicId !== data.gallery?.publicId));
  function viewUrl(path=page.url.pathname){return path+tagQuery(data.selectedTags,data.tagMode);}
  const roleNames = $derived<Record<string, string>>(Object.fromEntries(data.event.versions.map(v => [v.key,v.label])));
  const roleDescriptions: Record<string, string> = { social: 'A smaller, finished image for messages and social posts.', print: 'A finished image supplied by the photographer.', raw: 'An unprocessed camera file for photo-editing software. Usually very large.' };
  const availableRoles = $derived(data.event.versions.map(v => v.key).filter(r => data.event.variantPolicy[r] === 'free' && data.photos.some(p => sheetPhotoIds.includes(p.id) && p.files.some(f => f.role === r && f.downloadable))));
  function toggle(id: number) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selected = next; }
  function favorite(id: number) {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (favoritesOnly && previewId === id && !next.has(id)) {
      const remaining = visible.filter(p => p.id !== id);
      previewId = remaining.length ? remaining[Math.max(0, previewIndex) % remaining.length].id : null;
    }
    favorites = next;
    saveFavorites(data.event.id, next);
    activity(data.event.slug,next.has(id)?'favorite_add':'favorite_remove',{photoId:id});
  }
  function stepPreview(direction: number) { const index = visible.findIndex(p => p.id === previewId); previewId = visible[(index + direction + visible.length) % visible.length]?.id ?? null; }
  function openSheet(ids: number[]) {
    previewId = null; handedBatches=[]; lastBatch=null; sheetPhotoIds = ids; downloadError = ''; downloadStarted = false;
    const hasPrint = data.photos.some(p => ids.includes(p.id) && p.files.some(f => f.role === 'print' && f.downloadable));
    const first = hasPrint ? 'print' : data.event.versions.find(v => ids.every(id => data.photos.find(p => p.id === id)?.files.some(f => f.role === v.key && f.downloadable)))?.key;
    roles = first ? { [first]: true } : {}; sheetOpen = true;
  }
  const summary = $derived.by(() => {
    const chosen = Object.entries(roles).filter(([r, on]) => on && availableRoles.includes(r)).map(([r]) => r);
    let bytes = 0; let files = 0;
    const perRole: Record<string, { have: number; total: number; sizes: Set<string> }> = {};
    for (const r of availableRoles) perRole[r] = { have: 0, total: sheetPhotoIds.length, sizes: new Set() };
    for (const p of data.photos.filter(p => sheetPhotoIds.includes(p.id))) for (const f of p.files) if (f.downloadable && perRole[f.role]) {
      perRole[f.role].have++; if (f.width && f.height) perRole[f.role].sizes.add(`${f.width} × ${f.height} px`);
      if (chosen.includes(f.role)) { bytes += f.bytes; files++; }
    }
    return { chosen, bytes, files, perRole };
  });
  const incomplete = $derived(summary.chosen.some(r => summary.perRole[r].have < summary.perRole[r].total));
  const chosenFiles=$derived(data.photos.filter(p=>sheetPhotoIds.includes(p.id)).flatMap(p=>p.files.filter(f=>summary.chosen.includes(f.role)&&f.downloadable)));
  const batches=$derived.by(()=>{
    const groups:{ids:number[];bytes:number}[]=[];let group={ids:[] as number[],bytes:0};
    for(const id of sheetPhotoIds){const bytes=data.photos.find(p=>p.id===id)?.files.filter(f=>summary.chosen.includes(f.role)&&f.downloadable).reduce((n,f)=>n+f.bytes,0)??0;if(!bytes)continue;
      if(group.ids.length&&(group.ids.length>=20||group.bytes+bytes>100*1024*1024)){groups.push(group);group={ids:[],bytes:0};}group.ids.push(id);group.bytes+=bytes;}
    if(group.ids.length)groups.push(group);return groups;
  });
  let lastBatch=$state<number|null>(null), handedBatches=$state<number[]>([]);
  const downloadChoiceKey=$derived(chosenFiles.map(f=>f.id).join(','));
  $effect(()=>{downloadChoiceKey;handedBatches=[];downloadStarted=false;downloadError='';});
  async function download(ids=sheetPhotoIds,batch:number|null=null) {
    if (incomplete) return;
    busy = true; downloadError = ''; downloadStarted = false; lastBatch=batch;
    try {
      if (ids.length === 1 && data.photos.find(p=>p.id===ids[0])?.files.filter(f=>summary.chosen.includes(f.role)&&f.downloadable).length === 1) {
        const p = data.photos.find(x => x.id === ids[0])!;
        const f = p.files.find(x => summary.chosen.includes(x.role) && x.downloadable)!;
        const url = `/g/${data.event.slug}/file/${f.id}`;
        const check = await fetch(url, { method: 'HEAD' });
        if (!check.ok) throw new Error('That file could not be prepared. Please try again.');
        triggerDownload(url);
      } else {
        const r = await api<{ url: string }>(`/g/${data.event.slug}/api/zip`, { method: 'POST', json: { photoIds: ids, roles: summary.chosen } });
        triggerDownload(r.url);
      }
      downloadStarted = true; if(batch!==null&&!handedBatches.includes(batch))handedBatches=[...handedBatches,batch];
    } catch (err) { downloadError = err instanceof Error ? err.message : 'Download could not start. Your selection is still here; try again.'; }
    finally { busy = false; }
  }
</script>

<svelte:head><title>Photos · {data.event.name}</title></svelte:head>
{#if data.gallery}
<main class="gallery-workspace">
  <nav class="gallery-breadcrumb mb-7 flex flex-wrap items-center justify-between gap-3 text-sm"><a href={viewUrl(`/g/${data.event.slug}`)} class="button-quiet">← All collections</a><span class="eyebrow">{data.event.name}</span></nav>
  <header class="gallery-heading mb-6 flex flex-wrap items-end justify-between gap-5">
    <div><p class="eyebrow">{data.photos.length} photos</p><h1 class="display-title mt-2 text-4xl sm:text-6xl">{#if data.gallery.name}{data.gallery.name}{:else}Your photos{/if}</h1></div>
    {#key data.gallery.publicId + page.url.pathname + page.url.search}<FamilyVisit eventId={data.event.id} pid={data.gallery.publicId||null} photoIds={data.photos.map(p=>p.id)} />{/key}
  </header>
  {#if inApp}<p class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">If downloads do not start in this browser, use its menu to open the gallery in Safari or Chrome.</p>{/if}
  <PublicTags tags={data.tags} selectedTags={data.selectedTags} tagMode={data.tagMode} path={page.url.pathname} base={`/g/${data.event.slug}`} />
  <section aria-label="Gallery actions" class="gallery-actions">
    {#if data.event.orderingEnabled && orderingCollection && localFavorites}<a class="button-primary" href={`/g/${data.event.slug}/c/${orderingCollection}/order?favorites=1`}>Order favorite prints</a>{/if}
    <div class="flex flex-wrap gap-2"><button type="button" class="button-primary" disabled={!visible.length} onclick={() => openSheet(visible.map(p => p.id))}>{filtered || favoritesOnly ? `Download shown photos (${visible.length})` : 'Download all photos'}</button>{#if filtered || favoritesOnly}<button type="button" class="button-secondary" disabled={!data.photos.length} onclick={() => openSheet(data.photos.map(p => p.id))}>Download all {data.photos.length} photos</button>{/if}{#if data.event.orderingEnabled && data.gallery.publicId}<a href={`/g/${data.event.slug}/c/${data.gallery.publicId}/order`} class="button-secondary">Order prints ↗</a>{/if}</div>
  <div class="gallery-tabs mb-4 flex flex-wrap items-center gap-2"><button type="button" class={favoritesOnly ? 'button-secondary' : 'button-primary'} aria-pressed={!favoritesOnly} onclick={() => favoritesOnly = false}>All photos · {filteredPhotos.length}</button><button type="button" class={favoritesOnly ? 'button-primary' : 'button-secondary'} aria-pressed={favoritesOnly} onclick={() => favoritesOnly = true}>♥ Favorites · {localFavorites}</button></div>
  </section>
  {#if !data.photos.length}<div class="photo-card p-12 text-center"><h2 class="display-title text-3xl">Photos coming soon.</h2><p class="mt-3 text-stone-600">Photos are still being prepared. Check back soon.</p></div>
  {:else if !filteredPhotos.length}<div class="photo-card p-10 text-center"><h2 class="display-title text-3xl">No photos match this filter.</h2><a href={page.url.pathname} class="button-primary mt-4">Clear tag filters</a></div>
  {:else if !visible.length}<p class="py-12 text-center text-stone-600">Tap a photo’s heart to keep your favorites together here.</p>
  {:else}
    <div class="gallery-photo-grid">
      {#each visible as p, i (p.id)}
        <article data-guest-photo={p.id} class="photo-card gallery-photo-card">
          <div class="gallery-photo-stage relative bg-stone-100">
            <button type="button" class="block h-full w-full" onclick={() => previewId = p.id} aria-label={`Take a closer look at photo ${i + 1}`}><img src={photoUrl(p, 'thumb')} alt={`Photo ${i + 1}`} class="h-full w-full object-contain" loading="lazy" /></button>
            <button type="button" class={`absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-xl shadow-sm ${favorites.has(p.id) ? 'bg-amber-100 text-stone-900' : 'bg-white/95 text-stone-700'}`} aria-label={`${favorites.has(p.id) ? 'Remove favorite' : 'Favorite'} photo ${i + 1}`} aria-pressed={favorites.has(p.id)} onclick={() => favorite(p.id)}>{favorites.has(p.id) ? '♥' : '♡'}</button>
          </div>
          <div class="photo-card-actions px-2 py-2 sm:px-3"><div class="photo-card-meta flex items-center justify-between gap-1"><label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" checked={selected.has(p.id)} onchange={() => toggle(p.id)} />Select</label><a href={photoShareUrl(p, data.event.slug)} class="photo-share button-quiet text-xs" onclick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); void sharePhoto(p, data.event.slug); }} aria-label={`Share photo ${i + 1}`}>Share ↗</a></div><button type="button" class="photo-download button-secondary w-full text-xs" aria-label={`Download photo ${i + 1}`} onclick={() => openSheet([p.id])}><span>Download photo</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></svg></button></div>
        </article>
      {/each}
    </div>
  {/if}
  <details class="gallery-help mt-5 text-sm text-stone-600"><summary class="min-h-11 cursor-pointer py-3">About favorites &amp; downloads</summary><p class="pb-3">Favorites stay in this browser. Use Download for full-quality photos.</p></details>
  {#if otherCollections.length}
    <section class="mt-10 border-t border-stone-200 pt-6"><h2 class="eyebrow mb-4">More collections</h2><div class="flex gap-3 overflow-x-auto pb-3">{#each otherCollections as g, i (g.id)}<a href={viewUrl(`/g/${data.event.slug}/c/${g.publicId}`)} class="photo-card block w-40 shrink-0" aria-label={`Open another collection, ${g.photoCount} photos`}>{#if g.coverUrl}<img src={g.coverUrl} alt={`Collection ${i + 1}`} class="h-40 w-40 object-contain" loading="lazy" />{/if}<span class="block p-2 text-center text-xs">{g.photoCount} photos ↗</span></a>{/each}</div></section>
  {/if}
</main>
{#if selected.size}
  <div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur safe-bottom"><div class="mx-auto flex max-w-6xl flex-wrap items-center gap-2"><span class="mr-auto text-sm font-medium">{selected.size} selected{#if selectedHidden}<span class="block text-xs font-normal text-stone-600">{selectedHidden} hidden by your filters</span>{/if}</span><button type="button" class="button-quiet" onclick={() => selected = new Set([...selected, ...visible.map(p => p.id)])}>Select shown</button><button type="button" class="button-quiet" onclick={() => selected = new Set()}>Clear</button><button type="button" class="button-primary" onclick={() => openSheet([...selected])}>Download selected</button></div></div>
{/if}
<PhotoPreview photos={visible} onselect={id=>previewId=id} photo={previewPhoto} slug={data.event.slug} index={previewIndex} total={visible.length} onclose={() => previewId = null} ondownload={() => openSheet([previewId!])} onprevious={previewIndex >= 0 && visible.length > 1 ? () => stepPreview(-1) : undefined} onnext={previewIndex >= 0 && visible.length > 1 ? () => stepPreview(1) : undefined} favorite={previewId !== null && favorites.has(previewId)} onfavorite={() => favorite(previewId!)} />
<BottomSheet open={sheetOpen} title={sheetPhotoIds.length === 1 ? 'Download photo' : `Download ${sheetPhotoIds.length} photos`} onclose={() => sheetOpen = false}>
  <p class="mb-4 text-sm text-stone-600">Choose a version.</p>
  {#if availableRoles.length === 0}<p class="notice text-sm">A finished download is not available for these photos yet. Please check back or contact the photographer.</p>{/if}
  <fieldset disabled={busy} class="space-y-3">
    {#each availableRoles.filter(r => r !== 'raw') as r (r)}{@render roleChoice(r)}{/each}
    {#if availableRoles.includes('raw')}<details class="rounded-xl border border-stone-200 p-3"><summary class="cursor-pointer py-1 text-sm text-stone-600">Advanced: camera RAW</summary><div class="mt-3">{@render roleChoice('raw')}</div></details>{/if}
  </fieldset>
  {#if incomplete}<p role="status" class="notice mt-3 text-sm">Some selected versions are not ready for every photo. Choose another version or select fewer photos.</p>{:else}{#key chosenFiles.map(f=>f.id).join(',')}<PhoneSave slug={data.event.slug} files={chosenFiles} />{/key}{/if}
  <div class="mt-5 flex flex-wrap items-center justify-between gap-3"><span class="text-sm text-stone-600">{summary.files} file{summary.files === 1 ? '' : 's'} · about {formatBytes(summary.bytes)}</span><button type="button" class="button-primary" disabled={busy || incomplete || !summary.files} onclick={()=>download()}>{busy ? 'Checking selected files…' : downloadStarted ? 'Download again' : 'Download files ↓'}</button></div>
  {#if busy}<p role="status" class="mt-3 text-sm text-stone-600">Checking files and preparing your download{lastBatch!==null?` · part ${lastBatch+1}`:''}…</p>{/if}
  {#if batches.length>1}<details class="mt-4 rounded-xl border border-stone-200 p-3"><summary class="cursor-pointer font-medium">Download in smaller parts · {batches.length} parts</summary><p class="my-2 text-xs text-stone-500">Start one part at a time. “Started” means handed to your browser; check Downloads for completion.</p><div class="grid gap-2 sm:grid-cols-2">{#each batches as batch,i}<button type="button" class="button-secondary" disabled={busy || incomplete} onclick={()=>download(batch.ids,i)}>Part {i+1} · {batch.ids.length} photos · {formatBytes(batch.bytes)}{handedBatches.includes(i)?' · Started':''}</button>{/each}</div></details>{/if}
  {#if summary.bytes > 300 * 1024 * 1024}<p class="mt-3 text-xs text-amber-800">This is a large download. Wi-Fi and a little extra space on your device will help.</p>{/if}
  {#if downloadError}<p role="alert" class="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{downloadError} Your choices have been kept.</p>{/if}
  {#if downloadStarted}<div role="status" class="notice mt-4 text-sm"><strong>Your browser has been asked to download.</strong><p class="mt-1">Check Downloads or your Files app. Multiple photos arrive in a ZIP folder; open it to unpack them, then save the photos you want. Keep this page open while it starts.</p><p class="mt-2">Nothing appeared? Try again, or download fewer photos at a time. Your selection is still here.</p></div>{/if}
</BottomSheet>
{/if}
{#snippet roleChoice(r: string)}
  <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white p-4"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" bind:checked={roles[r]} /><span><span class="block font-semibold">{roleNames[r]}</span><span class="mt-1 block text-sm text-stone-600">{roleDescriptions[r] ?? 'A finished version provided by the photographer.'}</span>{#if summary.perRole[r]}<span class="mt-1 block text-xs text-stone-500">{#if summary.perRole[r].sizes.size === 1}{[...summary.perRole[r].sizes][0]} · {/if}Available for {summary.perRole[r].have} of {summary.perRole[r].total} selected photos</span>{/if}</span></label>
{/snippet}
