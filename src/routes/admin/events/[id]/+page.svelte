<script lang="ts">
  import { orderReferenceLabel } from '$shared/terminology';
  import { dismissOnBackdrop } from '$lib/client/dialog-backdrop';
  import {selectPhoto,selectionModifiers,preventRangeTextSelection} from '$lib/client/photo-selection';
  import SortingRecovery from '$lib/components/SortingRecovery.svelte';
  import {readDraft,draftKey,type DraftRecord} from '$lib/client/sorting-drafts';
  import OrganizePhotos from '$lib/components/OrganizePhotos.svelte';
  import ProjectLaunchGuide from '$lib/components/ProjectLaunchGuide.svelte';
  import ProjectPresentation from '$lib/components/ProjectPresentation.svelte';
  import CollectionOverview from '$lib/components/CollectionOverview.svelte';
  import CollectionBrowser from '$lib/components/CollectionBrowser.svelte';
  import PreviewFrame from '$lib/components/PreviewFrame.svelte';
  import { enhance } from '$app/forms';
  import { afterNavigate, beforeNavigate, invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick, untrack } from 'svelte';
  import { toast } from '$lib/client/toast.svelte';
  import { api, formatBytes, thumbUrl } from '$lib/client/api';
  import { formatCents } from '$shared/money';
  import ProjectTags from '$lib/components/ProjectTags.svelte';
  import ProjectLinkPreview from '$lib/components/ProjectLinkPreview.svelte';
  import { matchesTags,tagPath } from '$shared/tags';
  import { comparePhotoOrder } from '$shared/photo-order';
  import { lightroomMetadata, matchesPrivateMetadata } from '$lib/client/photo-organizer';
  let { data, form } = $props();
  let selectedIds = $state<number[]>([]);
  let selectionMode = $state(false);
  let tagsOpen = $state(false);
  let collectionsOpen = $state(false);
  let photoWorkspace = $state<'photos'|'collections'>('photos');
  let collectionSearch = $state('');
  let browsingCollectionKey = $state<string|null>(null);
  let filtersOpen = $state(false);
  const allPanels = [
    { key: 'photos', label: 'Photos' }, { key: 'presentation', label: 'Presentation' }, { key: 'sharing', label: 'Sharing' },
    { key: 'pricing', label: 'Sales' }, { key: 'settings', label: 'Settings' }
  ] as const;
  const panels = $derived(allPanels.filter(p => p.key !== 'pricing' || data.event.orderingEnabled));
  type Panel = typeof allPanels[number]['key'];
  const panelFromHash = (hash: string): Panel => panels.find(p => `#project-${p.key}` === hash)?.key ?? 'photos';
  let activePanel = $state<Panel>(panelFromHash(page.url.hash));
  afterNavigate(() => { activePanel = panelFromHash(window.location.hash); });
  $effect(() => { if (activePanel === 'pricing' && !data.event.orderingEnabled) activePanel = 'settings'; });
  let projectBar: HTMLElement;
  let barHeight = $state(120);
  let settingsDirty = $state(false), pricingDirty = $state(false), presentationDirty = $state(false);
  const panelScroll: Record<Panel, number> = { photos: 0, presentation: 0, sharing: 0, settings: 0, pricing: 0 };
  async function switchPanel(next: Panel) {
    if (next === activePanel) return;
    panelScroll[activePanel] = window.scrollY;
    activePanel = next;
    const url = new URL(page.url); url.hash = `project-${next}`;
    replaceState(url, page.state);
    await tick();
    window.scrollTo({ top: panelScroll[next], behavior: 'instant' });
  }
  function tabKey(event: KeyboardEvent, current: Panel) {
    const index = panels.findIndex(p => p.key === current);
    const target = event.key === 'ArrowRight' ? (index + 1) % panels.length
      : event.key === 'ArrowLeft' ? (index + panels.length - 1) % panels.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    void switchPanel(panels[target].key);
    document.getElementById(`project-tab-${panels[target].key}`)?.focus({ preventScroll: true });
  }
  beforeNavigate(({ cancel }) => {
    if ((settingsDirty || pricingDirty || presentationDirty) && !confirm('Leave without saving your project changes?')) cancel();
  });
  let selectionAnchor=$state<number|null>(null);
  let selectionScope="";
  let filter = $state('all');
  let ratingFilter = $state('all');
  let chosenTags=$state<number[]>([]);
  let tagMode=$state<'any'|'all'>('any');
  let untagged=$state(false);
  let captureDateFilter = $state('all');
  let keywordFilter = $state<string | null>(null);
  let search = $state('');
  let targetId = $state('new');
  let sortingBatch = $state<typeof data.photos>([]);
  let shotDirection = $state('asc');
  let previewId = $state<number | null>(null);
  let previewDialog: HTMLDialogElement;
  let expiresLocal = $state('');
  let browserClock = $state(false);
  const timezone = $derived(browserClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
  const timezoneOffset = $derived(expiresLocal && browserClock ? new Date(expiresLocal).getTimezoneOffset() : 0);
  const link = $derived(`${data.publicOrigin}/g/${data.event.slug}`);
  const preview = $derived(data.photos.find((p) => p.id === previewId));
  const previewMetadata = $derived(preview ? lightroomMetadata(preview) : null);
  // Dates help the owner select a batch, but never infer identity or assign a day.
  // Wait for the browser timezone before offering dates; server timezone is irrelevant.
  function captureDate(value: string | null): string {
    if (!value || !browserClock) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  const captureDates = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const p of data.photos) { const date = captureDate(p.takenAt); if (date) counts.set(date, (counts.get(date) ?? 0) + 1); }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  });
  const undatedCount = $derived(browserClock ? data.photos.filter((p) => !captureDate(p.takenAt)).length : 0);
  const shown = $derived(data.photos.filter((p) => (untagged ? !data.tagAssignments[p.id]?.length : matchesTags(data.tags,data.tagAssignments[p.id]??[],chosenTags,tagMode))
    && (captureDateFilter === 'all' || (captureDateFilter === 'undated' ? !captureDate(p.takenAt) : captureDate(p.takenAt) === captureDateFilter))
    && (filter === 'all' || (filter === 'pending' ? p.files.length > 0 && p.renditionStatus !== 'ready' : filter === 'noraw' ? p.sidecars.length > 0 && !p.files.some((f) => f.role === 'raw') : !p.files.some((f) => f.role === 'print')))
    && matchesPrivateMetadata(p, search, ratingFilter, keywordFilter)).sort((a, b) => shotDirection === 'desc' ? comparePhotoOrder(b, a) : comparePhotoOrder(a, b)));
  const shownIds = $derived(new Set(shown.map((p) => p.id)));
  const previewIndex = $derived(shown.findIndex(p => p.id === previewId));
  function stepPreview(direction: number) { if (shown.length && previewIndex >= 0) previewId = shown[(previewIndex + direction + shown.length) % shown.length].id; }
  const hiddenSelectedCount = $derived(selectedIds.filter((id) => !shownIds.has(id)).length);
  const targets = $derived(data.galleries.filter((g) => !g.isIntake));
  const visibleCollections = $derived(data.galleries.filter(g=>g.isIntake||g.name.toLowerCase().includes(collectionSearch.toLowerCase())));
  const browseCollections = $derived(targets.map(g=>({key:String(g.id),id:g.id,name:g.name})));
  $effect(() => {
    const result = form;
    // Toasts read/write their reactive queue. Track only a new form result, not
    // that queue, or a successful action can recursively repeat its own toast.
    untrack(() => { if (result?.ok) toast(String(result.ok), 'success'); if (result?.error) toast(String(result.error), 'error'); if (result && 'organized' in result && result.organized) clearSelection(); });
  });
  $effect(() => { const valid = new Set(data.photos.map((p) => p.id)); const next = selectedIds.filter((id) => valid.has(id)); if (next.length !== selectedIds.length) selectedIds = next; });
  $effect(()=>{const scope=`${data.event.id}:${data.selected?.id??'all'}`;if(scope!==selectionScope){selectionScope=scope;selectionAnchor=null;}});
  let loadedExpiry = '';
  $effect(() => {
    const key = `${data.event.expiresAt}:${browserClock}`;
    if (key === loadedExpiry) return;
    loadedExpiry = key;
    if (!data.event.expiresAt) { expiresLocal = ''; return; }
    const d = new Date(data.event.expiresAt);
    expiresLocal = browserClock ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : d.toISOString().slice(0, 16);
  });
  // Keep the chosen batch fixed, but don't freeze its previews at opening time.
  $effect(() => {
    const latest = new Map(data.photos.map(p => [p.id, p]));
    untrack(() => { if (sortingBatch.length) sortingBatch = sortingBatch.map(p => latest.get(p.id) ?? p); });
  });
  onMount(() => {
    browserClock = true;
    const observer = new ResizeObserver(() => { barHeight = projectBar.offsetHeight; });
    observer.observe(projectBar);
    const restorePanel = () => { activePanel = panelFromHash(window.location.hash); };
    const protectDraft = (event: BeforeUnloadEvent) => { if (settingsDirty || pricingDirty || presentationDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('hashchange', restorePanel);
    window.addEventListener('beforeunload', protectDraft);
    let busy = false, disposed = false;
    const controller = new AbortController();
    async function refreshPhotos() {
      // Do not reload editable project forms or overlap background requests.
      if (busy || disposed || document.hidden || activePanel !== 'photos' || settingsDirty || pricingDirty || presentationDirty || document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]')) return;
      busy = true;
      const eventId = data.event.id;
      try {
        const state = await api<{ revision: string }>(`/admin/api/events/${eventId}/photo-state`, { signal: controller.signal, cache: 'no-store' });
        if (!disposed && data.event.id === eventId && state.revision !== data.photoRevision) await invalidateAll();
      } catch { /* A temporary connection loss must not disturb the sorting draft. */ }
      finally { busy = false; }
    }
    const timer = setInterval(refreshPhotos, 10000);
    document.addEventListener('visibilitychange', refreshPhotos);
    window.addEventListener('focus', refreshPhotos);
    return () => { observer.disconnect(); window.removeEventListener('hashchange', restorePanel); window.removeEventListener('beforeunload', protectDraft); disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refreshPhotos); window.removeEventListener('focus', refreshPhotos); };
  });
  let recoveredDraft=$state<DraftRecord|undefined>(),recoveryRefresh=$state(0);
  function resumeSorting(record:DraftRecord){if(!record.draft)return;const batch=data.photos.filter(p=>record.draft!.photoIds.includes(p.id)).sort(comparePhotoOrder);if(batch.length!==record.draft.photoIds.length){toast('Some draft photos are not in this view. Open All photos, then resume the draft.','error');return;}recoveredDraft=record;sortingBatch=batch;}
  async function openSorting(){try{const record=await readDraft(draftKey(data.admin!.id,data.event.id));if(record.draft){toast('Resume or discard the existing device draft before starting another batch.','error');recoveryRefresh++;return;}}catch{/* The sorting dialog will explain a device-storage failure. */}recoveredDraft=undefined;sortingBatch=data.photos.filter(p=>selectedIds.includes(p.id)).sort(comparePhotoOrder);}

  async function finishSorting(count: number) { sortingBatch = []; recoveredDraft=undefined;recoveryRefresh++; clearSelection(); selectionMode=false; toast(`${count} photos filed in their collections.`, 'success'); await invalidateAll(); }
  function clearSelection(){selectedIds=[];selectionAnchor=null;}
  function selectImage(id:number,event:MouseEvent & {pointerType?:string}){const next=selectPhoto(selectedIds,shown.map(p=>p.id),selectionAnchor,id,selectionModifiers(event));selectedIds=next.selected;selectionAnchor=next.anchor;}
  function checkImage(id:number,event:MouseEvent & {pointerType?:string}){selectionMode=true;const next=selectPhoto(selectedIds,shown.map(p=>p.id),selectionAnchor,id,{...selectionModifiers(event),toggleOnly:true});selectedIds=next.selected;selectionAnchor=next.anchor;}
  function toggle(id:number){selectionMode=true;selectedIds=selectedIds.includes(id)?selectedIds.filter(n=>n!==id):[...selectedIds,id];selectionAnchor=id;}
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); toast('Link copied.', 'success'); } catch { toast('Could not copy. Select the link and copy it manually.', 'error'); } }
  async function retry(id: number) { try { await api(`/admin/api/photos/${id}/retry`, { method: 'POST' }); toast('Queued for another try.', 'success'); await invalidateAll(); } catch (err) { toast(err instanceof Error ? err.message : 'Please try again.', 'error'); } }
  function inspect(id: number) { previewId = id; previewDialog.showModal(); }
  function selectShown() { selectionMode=true; selectedIds = [...new Set([...selectedIds, ...shown.map((p) => p.id)])]; selectionAnchor=null; }
  function clearPhotoFilters() { filter = 'all'; ratingFilter = 'all'; keywordFilter = null; search = ''; chosenTags=[];untagged=false; captureDateFilter = 'all'; }
</script>

<svelte:head><title>{data.event.name} · Photo studio</title></svelte:head>
<a href="/admin" class="text-sm text-stone-500 hover:underline">← All projects</a>
<div class="project-workspace" style={`--project-bar-height: ${barHeight}px`}>
<div class="project-bar" bind:this={projectBar}>
  <header class="flex min-w-0 items-center gap-3 py-3">
    <div class="min-w-0 flex-1"><h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl" title={data.event.name}>{data.event.name}</h1>
      <span class={`text-xs ${data.event.isPublished ? 'text-emerald-800' : 'text-amber-900'}`}>{data.event.isPublished ? 'Published' : 'Private draft'}</span>
    </div>
    <a href={`/admin/visibility?event=${data.event.id}`} class="button-quiet shrink-0">Visibility</a>
    <a href={`/admin/events/${data.event.id}/upload`} class="button-primary shrink-0">Upload photos</a>
  </header>
  <div role="tablist" aria-label="Project workspace" class="project-tabs">
    {#each panels as panel (panel.key)}
      <button type="button" role="tab" aria-label={panel.label} id={`project-tab-${panel.key}`} aria-selected={activePanel === panel.key} aria-controls={`project-${panel.key}`} tabindex={activePanel === panel.key ? 0 : -1} onclick={() => switchPanel(panel.key)} onkeydown={event => tabKey(event, panel.key)}>
        {panel.label}{#if (panel.key === 'settings' && settingsDirty) || (panel.key === 'pricing' && pricingDirty) || (panel.key === 'presentation' && presentationDirty)}<span class="ml-1 text-amber-800" aria-label="Unsaved changes">●</span>{/if}
      </button>
    {/each}
  </div>
</div>

<div id="project-photos" class="project-panel" role="tabpanel" aria-labelledby="project-tab-photos" hidden={activePanel !== 'photos'} tabindex="0">
{#if data.admin&&!sortingBatch.length}<SortingRecovery actorId={data.admin.id} eventId={data.event.id} refresh={recoveryRefresh} onresume={resumeSorting} onundo={()=>invalidateAll()} />{/if}
<ProjectLaunchGuide guide={data.launchGuide} eventId={data.event.id} onopen={switchPanel} />
<section aria-label="Project readiness" class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-stone-200 pb-4 text-sm text-stone-600">
  <span><strong class="text-stone-900">{data.readiness.total}</strong> photos</span>
  <a href={`?g=${data.galleries.find(g=>g.isIntake)?.id??''}`} class="hover:underline"><strong class="text-stone-900">{data.readiness.intake}</strong> to sort</a>
  {#if data.readiness.ready < data.readiness.total}<span>{data.readiness.ready} previews ready</span>{/if}
  {#if data.readiness.missingPrint}<span class="text-amber-900">{data.readiness.missingPrint} missing full-resolution files</span>{/if}
</section>
{#if data.readiness.failed}<p class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{data.readiness.failed} preview{data.readiness.failed === 1 ? '' : 's'} need attention. Filter for processing / failed to see details and retry.</p>{/if}

<div class="workspace-view-switch" aria-label="Photo workspace view">
  <button type="button" aria-pressed={photoWorkspace==='photos'} onclick={()=>photoWorkspace='photos'}>Photo grid</button>
  <button type="button" aria-pressed={photoWorkspace==='collections'} onclick={()=>photoWorkspace='collections'}>Collection overview</button>
  {#if photoWorkspace==='collections' && selectedIds.length}<button type="button" class="ml-auto" onclick={openSorting}>Organize {selectedIds.length} selected photos</button>{/if}
</div>
<div hidden={photoWorkspace!=='collections'} class="mt-5"><CollectionOverview collections={targets} eventId={data.event.id} onbrowse={key=>browsingCollectionKey=key} /></div>
<div hidden={photoWorkspace!=='photos'}>
<div class="collection-workspace mt-5 grid gap-6 lg:grid-cols-[230px_1fr]">
  <aside>
    <button type="button" class="button-secondary w-full justify-between lg:hidden" aria-expanded={collectionsOpen} onclick={()=>collectionsOpen=!collectionsOpen}>Collections · {data.selected?.name??'All photos'} <span aria-hidden="true">⌄</span></button>
    <div class={collectionsOpen?'':'hidden lg:block'}>
    <h2 class="text-sm font-semibold">Collections <span class="font-normal text-stone-500">· private labels</span></h2>
    {#if targets.length}<button type="button" class="button-secondary mt-3 w-full" onclick={()=>browsingCollectionKey=String(data.selected&&!data.selected.isIntake?data.selected.id:targets[0].id)}>Browse collections</button>{/if}
    {#if targets.length>6}<input type="search" aria-label="Find collection in sidebar" bind:value={collectionSearch} placeholder="Find collection…" class="mt-3 w-full rounded-lg border border-stone-300 p-2 text-sm" />{/if}
    <nav aria-label="Photo collections" class="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
      <a href={`/admin/events/${data.event.id}`} aria-current={!data.selected ? 'page' : undefined} class={`flex items-center gap-3 rounded-xl border p-3 text-sm ${!data.selected ? 'border-amber-400 bg-amber-50 font-semibold' : 'border-stone-200 bg-white'}`}><span class="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-100 text-xl">▦</span><span>All photos <small class="block font-normal text-stone-500">{data.readiness.total} photos</small></span></a>
      {#each visibleCollections as g (g.id)}
        <a href={`?g=${g.id}`} aria-current={data.selected?.id === g.id ? 'page' : undefined} class={`flex items-center gap-3 rounded-xl border p-2 text-sm ${data.selected?.id === g.id ? 'border-amber-400 bg-amber-50 font-semibold' : 'border-stone-200 bg-white'}`}>
          {#if g.coverThumbId}<img src={thumbUrl(g.coverThumbId, g.coverHash)} alt="" class="h-20 w-20 shrink-0 rounded-lg bg-stone-100 object-contain" loading="lazy" />{:else}<span class="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xl">{g.isIntake ? '↳' : '♡'}</span>{/if}
          <span class="min-w-0 break-words">{g.name}<small class="block font-normal text-stone-500">{g.photoCount} photos{g.isIntake ? ' · private' : ''}</small></span>
        </a>
      {/each}
    </nav>
    <details class="mt-3 rounded-xl border border-stone-200 bg-white p-3"><summary class="cursor-pointer text-sm font-medium">+ New collections</summary><form method="post" action="?/addGalleries" use:enhance class="mt-3"><label class="text-xs">Private labels, one per line<textarea name="names" rows="3" placeholder="Highlights&#10;Ceremony&#10;Reception" class="mt-1 w-full rounded-lg border border-stone-300 p-2"></textarea></label><p class="mb-2 text-xs text-stone-500">Leave blank for a fresh unnamed collection.</p><button class="rounded-lg bg-stone-900 px-3 py-2 text-xs text-white">Create collections</button></form></details>
    {#if data.archived.length}<details class="mt-3 rounded-xl border border-stone-200 p-3"><summary class="cursor-pointer text-xs">Archived ({data.archived.length})</summary>{#each data.archived as g (g.id)}<form method="post" action="?/archive" use:enhance class="mt-2 flex items-center justify-between gap-2 text-xs"><input type="hidden" name="galleryId" value={g.id} /><input type="hidden" name="restore" value="1" /><span>{g.name}</span><button class="underline">Restore</button></form>{/each}</details>{/if}
    </div>
  </aside>
  <main class="min-w-0">
    <div class="flex flex-wrap items-start gap-3"><div><h2 class="text-xl font-semibold">{data.selected?.name ?? 'All photos'}</h2><p class="mt-1 text-xs text-stone-500">{shown.length} photos{data.selected?.isIntake ? " · private" : ""}</p></div>
      {#if data.selected && !data.selected.isIntake}<button type="button" class="ml-auto rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs" onclick={() => copy(`${link}/c/${data.selected!.publicId}`)}>Copy collection link</button>{/if}
    </div>
    {#if data.selected && !data.selected.isIntake}
      <section aria-label="Collection cover" class="mt-3 flex items-center gap-3 text-xs text-stone-600">
        {#if data.selected.coverThumbId}<img src={thumbUrl(data.selected.coverThumbId,data.selected.coverHash)} alt="Current collection cover" class="h-12 w-10 rounded-lg object-cover" />{/if}
        <span>Cover · {data.selected.coverPhotoId ? data.selected.coverPhotoId===data.selected.coverThumbId ? 'Pinned' : 'Automatic fallback' : 'Automatic'}</span>
        {#if data.selected.coverPhotoId}<form method="post" action="?/setCover" use:enhance><input type="hidden" name="galleryId" value={data.selected.id} /><input type="hidden" name="photoId" value="" /><button class="underline">Use automatic</button></form>{/if}
      </section>
    {/if}
    <div class="photo-toolbar mt-4">
      <label class="sr-only" for="photo-search">Find by filename, private label, or Lightroom keyword</label><input id="photo-search" type="search" bind:value={search} placeholder="Search photos…" class="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm" />
      <select aria-label="Photo order" bind:value={shotDirection} class="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"><option value="asc">Shot number ↑</option><option value="desc">Shot number ↓</option></select>
      <button type="button" aria-expanded={filtersOpen} class="button-quiet" onclick={()=>filtersOpen=!filtersOpen}>Filters{filter!=='all'||ratingFilter!=='all'||captureDateFilter!=='all'?' •':''}</button>
      <button type="button" aria-pressed={selectionMode} class={selectionMode?'button-primary':'button-secondary'} onclick={()=>selectionMode=!selectionMode}>{selectionMode?'Done selecting':'Select photos'}</button>
      {#if selectionMode}<button type="button" class="button-quiet" onclick={selectShown} disabled={!shown.length}>Select shown ({shown.length})</button><details class="relative text-xs"><summary class="cursor-pointer py-3">Shortcuts</summary><p class="absolute right-0 z-30 w-60 rounded-lg border border-stone-200 bg-white p-3 shadow-lg">Shift: add range<br />Ctrl / ⌘: toggle photo</p></details>{/if}
    </div>
    {#if filtersOpen}<section aria-label="Photo filters" class="mt-2 flex flex-wrap gap-3 rounded-xl border border-stone-200 bg-white p-3">
      <label class="text-xs">Status<select aria-label="Photo status" bind:value={filter} class="mt-1 block rounded-lg border p-2 text-sm"><option value="all">All photos</option><option value="pending">Processing / failed</option><option value="noprint">Missing print file</option><option value="noraw">Sidecar awaiting RAW</option></select></label>
      <label class="text-xs">Rating<select aria-label="Lightroom rating" bind:value={ratingFilter} class="mt-1 block rounded-lg border p-2 text-sm"><option value="all">Any Lightroom rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="5">5 stars</option><option value="unrated">Unrated</option><option value="rejected">Marked rejected</option></select></label>
      <label class="text-xs">Shooting date<select aria-label="Shooting date" title={timezone} bind:value={captureDateFilter} disabled={!browserClock} class="mt-1 block rounded-lg border p-2 text-sm"><option value="all">All shooting dates</option>{#each captureDates as [date,count] (date)}<option value={date}>{date} · {count}</option>{/each}{#if undatedCount}<option value="undated">No shooting date · {undatedCount}</option>{/if}</select></label>
      <button type="button" class="button-quiet self-end" onclick={clearPhotoFilters}>Clear filters</button>
    </section>{/if}
    {#if data.selected && !data.selected.isIntake}<details class="mt-3 rounded-xl border border-stone-200 bg-white p-3"><summary class="cursor-pointer text-xs font-medium">Collection details & organization</summary><div class="mt-3 grid gap-4 sm:grid-cols-2"><form method="post" action="?/renameGallery" use:enhance><input type="hidden" name="galleryId" value={data.selected.id} /><label class="text-xs">Private label<input name="name" value={data.selected.name} maxlength="120" class="mt-1 w-full rounded-lg border border-stone-300 p-2" /></label><button class="mt-2 rounded-lg border border-stone-300 px-3 py-2 text-xs">Save label</button></form><form method="post" action="?/merge" use:enhance onsubmit={(e) => { if (!confirm('Combine these collections? Photos and orders stay intact; this source collection will be archived.')) e.preventDefault(); }}><input type="hidden" name="sourceId" value={data.selected.id} /><label class="text-xs">Combine into another collection<select name="targetId" required class="mt-1 w-full rounded-lg border border-stone-300 p-2"><option value="">Choose destination</option>{#each targets.filter((g) => g.id !== data.selected?.id) as g (g.id)}<option value={g.id}>{g.name}</option>{/each}</select></label><button class="mt-2 rounded-lg border border-stone-300 px-3 py-2 text-xs">Combine collections</button></form></div><form method="post" action="?/archive" use:enhance class="mt-3" onsubmit={(e) => { if (!confirm('Archive this collection? It will no longer appear in the shared gallery. Photos stay safe and the collection can be restored.')) e.preventDefault(); }}><input type="hidden" name="galleryId" value={data.selected.id} /><button class="text-xs text-stone-600 underline">Archive collection (keep all photos)</button></form></details>{/if}
    <details id="tag-panel" bind:open={tagsOpen} class="mt-3 rounded-xl border border-stone-200 bg-white"><summary class="cursor-pointer px-4 py-3 text-sm font-medium">Project tags <span class="font-normal text-stone-500">· {chosenTags.length ? `${chosenTags.length} filters active` : untagged ? 'Untagged' : `${data.tags.length} tags`}</span></summary>    <ProjectTags eventId={data.event.id} tags={data.tags} assignments={data.tagAssignments} photoIds={data.photos.map(p=>p.id)} {selectedIds} baseUrl={link} collectionId={data.selected && !data.selected.isIntake ? data.selected.publicId : ''} bind:chosen={chosenTags} bind:mode={tagMode} bind:untagged /></details>
    {#if keywordFilter !== null}<div class="mb-3 flex items-center gap-2 text-xs"><span class="rounded-full bg-sky-100 px-3 py-1 text-sky-900">Keyword: {keywordFilter}</span><button type="button" class="underline" onclick={() => keywordFilter = null}>Clear keyword filter</button></div>{/if}
    {#if selectedIds.length}
      <section aria-label="Selected photo actions" style="top: calc(var(--project-bar-height) + .5rem)" class="sticky z-20 mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-3"><strong class="text-sm">{selectedIds.length} photo{selectedIds.length === 1 ? '' : 's'} selected</strong><button type="button" class="ml-auto text-xs underline" onclick={clearSelection}>Clear selection</button><button type="button" class="button-secondary text-xs" onclick={()=>{tagsOpen=true;document.getElementById("tag-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Tag selected photos</button><button type="button" onclick={openSorting} class="rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white">Organize {selectedIds.length} photo{selectedIds.length === 1 ? '' : 's'}</button></div>
        {#if hiddenSelectedCount}<p class="mt-2 text-xs font-medium text-amber-950" role="status">{hiddenSelectedCount} selected photo{hiddenSelectedCount === 1 ? ' is' : 's are'} hidden by the current filters. Actions apply to all {selectedIds.length} selected photos. <button type="button" class="underline" onclick={() => selectedIds = selectedIds.filter((id) => shownIds.has(id))}>Keep only visible selection</button></p>{/if}
        {#if data.selected && !data.selected.isIntake}
          <details class="mt-2"><summary class="cursor-pointer text-xs font-medium">Move out of this collection</summary>
            <form method="post" action="?/organize" use:enhance class="mt-3 flex flex-wrap items-end gap-2">
              {#each selectedIds as id (id)}<input type="hidden" name="photoId" value={id} />{/each}<input type="hidden" name="sourceId" value={data.selected.id} /><input type="hidden" name="mode" value="move" />
              <label class="text-xs">Destination<select bind:value={targetId} name="targetId" class="mt-1 block max-w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"><option value="new">+ New collection</option>{#each data.galleries.filter(g => g.id !== data.selected?.id) as g (g.id)}<option value={String(g.id)}>{g.name}</option>{/each}</select></label>
              {#if targetId === 'new'}<label class="text-xs">Private label (optional)<input name="newLabel" maxlength="120" class="mt-1 block rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" /></label>{/if}
              <button class="rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm">Move from this collection</button>
              <p class="w-full text-xs text-stone-600">Removes these photos from this collection only. Other collection memberships are kept.</p>
            </form>
          </details>
        {/if}
      </section>
    {/if}
    {#if !shown.length}<div class="rounded-2xl border-2 border-dashed border-stone-200 p-10 text-center"><p class="text-lg font-medium">No photos here yet.</p><p class="mt-2 text-sm text-stone-500">{data.readiness.total ? 'Try another filter, or add photos from All photos.' : 'Upload photos to get started.'}</p>{#if data.photos.length}<button type="button" class="mt-3 text-sm underline" onclick={clearPhotoFilters}>Clear filters</button>{/if}</div>{/if}
    <div class="organizer-grid mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {#each shown as p (p.id)}
        {@const metadata = lightroomMetadata(p)}
        <article class={`organizer-photo overflow-hidden rounded-xl border-2 bg-white ${selectedIds.includes(p.id) ? 'border-amber-500' : 'border-transparent shadow-sm'}`}>
          <div class="relative"><button type="button" data-photo-select={p.id} class="block w-full select-none bg-stone-100 text-left" onmousedown={e=>{if(selectionMode)preventRangeTextSelection(e);}} onclick={(e) => selectionMode?selectImage(p.id,e):inspect(p.id)} aria-pressed={selectionMode?selectedIds.includes(p.id):undefined} aria-label={selectionMode?`Select photo ${p.displayName}`:`Open photo ${p.displayName}`}>
              {#if p.renditionStatus === 'ready'}<img src={thumbUrl(p.id, p.renditionHash)} alt={p.displayName} draggable="false" class="aspect-[4/5] w-full object-contain" loading="lazy" />{:else}<span class="flex aspect-[4/5] items-center justify-center p-4 text-center text-sm text-stone-500">{!p.files.length ? 'Sidecars saved · waiting for RAW or JPEG' : p.renditionStatus === 'failed' ? 'Preview failed' : 'Making a preview…'}</span>{/if}
            </button><button type="button" data-photo-check={p.id} aria-pressed={selectedIds.includes(p.id)} aria-label={`${selectedIds.includes(p.id)?'Deselect':'Select'} ${p.displayName}`} onmousedown={preventRangeTextSelection} onclick={e=>checkImage(p.id,e)} class={`absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-amber-600`}><span class={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${selectedIds.includes(p.id)?'border-amber-600 bg-amber-500 text-white':'border-white bg-black/35 text-white/70'}`}>✓</span></button></div>
          <div class="p-3"><p class="truncate text-xs font-medium" title={p.displayName}>{p.displayName}</p><p class="mt-1 text-[11px] text-stone-500">{p.collections.map((g) => g.name).join(' · ')}</p>
            <div class="mt-2 flex flex-wrap gap-1">{#each data.tagAssignments[p.id] ?? [] as tid}<span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">{tagPath(data.tags,tid)}</span>{/each}</div>
            {#if metadata?.rating}<span class="text-xs text-stone-500">{metadata.rating===-1?'Rejected':`${metadata.rating} ★`}</span>{/if}
            {#if p.sidecars.length && !p.files.some(f=>f.role==='raw')}<p class="mt-1 text-xs text-amber-900">Awaiting RAW</p>{/if}
            {#if p.renditionStatus !== 'ready' && p.files.length}{#if p.renderError}<p class="mt-2 break-words text-[11px] text-red-700">{p.renderError}</p>{/if}<button type="button" class="mt-2 rounded-lg border border-stone-300 px-2 py-1 text-xs" onclick={() => retry(p.id)}>Retry preview</button>{/if}
            {#if data.selected && !data.selected.isIntake && p.renditionStatus==='ready'}<form method="post" action="?/setCover" use:enhance class="mt-2"><input type="hidden" name="galleryId" value={data.selected.id} /><input type="hidden" name="photoId" value={p.id} /><button disabled={data.selected.coverPhotoId===p.id} class="text-[11px] underline disabled:no-underline">{data.selected.coverPhotoId===p.id ? '✓ Pinned cover' : data.selected.coverThumbId===p.id ? 'Pin this automatic cover' : 'Use as cover'}</button></form>{/if}
          </div>
        </article>
      {/each}
    </div>
  </main>
</div>
</div>

</div>

<div id="project-presentation" role="tabpanel" aria-labelledby="project-tab-presentation" hidden={activePanel !== 'presentation'} tabindex="0" class="project-panel project-config"><ProjectPresentation bind:dirty={presentationDirty} layout={data.event.galleryLayout} collections={data.presentationCollections} eventId={data.event.id} /></div>

<div id="project-sharing" role="tabpanel" aria-labelledby="project-tab-sharing" hidden={activePanel !== 'sharing'} tabindex="0" class="project-panel project-config"><h2 class="text-xl font-semibold">Sharing & access</h2><a class="button-primary my-4" href={`/admin/events/${data.event.id}/access`}>Manage scoped invitations & proofing →</a>{#if data.event.scopedSharingOnly}<p class="notice">The broad project link below is disabled for guests. Use a scoped invitation.</p>{/if}<p class="mt-1 text-sm text-stone-500">Private collection labels stay private. Only optional public titles and descriptions entered in Presentation are shared. The To sort tray is never shared.</p><div class="mt-3 flex flex-wrap items-center gap-2"><input aria-label="Project link" readonly value={data.linkPreview.shareUrl} class="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" /><button type="button" class="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white" onclick={() => copy(data.linkPreview.shareUrl)}>Copy project link</button><a href={`/g/${data.event.slug}`} target="_blank" rel="noopener" class="rounded-lg border border-stone-300 px-3 py-2 text-sm">Admin draft preview ↗</a><a href={`/admin/preview/${data.event.id}`} target="_blank" rel="noopener" class="rounded-lg border border-stone-300 px-3 py-2 text-sm">Test guest access ↗</a></div><p class="mt-2 text-xs text-stone-500">Draft preview can see unpublished work. Test guest access checks publication, passwords and closing time.</p>
  <ProjectLinkPreview preview={data.linkPreview} photos={data.sharePhotos} photoId={data.event.sharePhotoId} />
  <details class="mt-4"><summary class="cursor-pointer text-sm">Password & link settings</summary><form method="post" action="?/password" use:enhance class="mt-3 flex flex-wrap items-end gap-2"><label class="text-xs">Project password {data.event.passwordHash ? '(set)' : '(not set)'}<input name="password" type="password" autocomplete="new-password" placeholder="At least 4 characters" class="mt-1 block rounded-lg border border-stone-300 p-2" /></label><button class="rounded-lg border border-stone-300 px-3 py-2 text-xs">Set password</button>{#if data.event.passwordHash}<button name="clear" value="1" class="rounded-lg border border-stone-300 px-3 py-2 text-xs">Remove password</button>{/if}</form><form method="post" action="?/rotate" use:enhance class="mt-3" onsubmit={(e) => { if (!confirm('Replace the project link? All old project links will stop working.')) e.preventDefault(); }}><button class="text-xs underline">Replace project link</button></form></details>
</div>
<div id="project-settings" role="tabpanel" aria-labelledby="project-tab-settings" hidden={activePanel !== 'settings'} tabindex="0" class="project-panel project-config"><h2 class="text-xl font-semibold">Project settings</h2><form method="post" action="?/update" oninput={() => settingsDirty = true} use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') settingsDirty = false; }} class="mt-4"><fieldset class="settings-group"><legend>Project</legend><div class="grid gap-4 sm:grid-cols-2"><label class="text-xs">Project name<input name="name" value={data.event.name} required class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm" /></label>{#if data.event.orderingEnabled}<label class="text-xs">Order reference label<input name="subjectLabel" value={orderReferenceLabel(data.event.subjectLabel)} maxlength="80" placeholder="Order reference" class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm" /><span class="mt-1 block text-stone-500">Optional checkout field. For example: Participant name, Team, or Project reference. Leave blank for “Order reference”.</span></label>{/if}<label class="text-xs">Project tagline <span class="text-stone-500">(optional)</span><input name="tagline" value={data.event.tagline??''} maxlength="180" placeholder="Leave blank for title only" class="mt-1 w-full rounded-lg border border-stone-300 p-2" /><span class="mt-1 block text-stone-500">Shown beneath the project title and on its public gallery.</span></label><label class="text-xs">Automatic collection covers<select aria-label="Automatic collection covers" name="collectionCoverPolicy" class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm"><option value="exclusive" selected={data.event.collectionCoverPolicy==='exclusive'}>Prefer photos in only this collection</option><option value="first" selected={data.event.collectionCoverPolicy==='first'}>First photo in shot order</option></select></label><label class="text-xs">Project date<input name="eventDate" type="date" value={data.event.eventDate ?? ''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm" /></label><label class="text-xs">Closes ({timezone})<input name="expiresLocal" type="datetime-local" bind:value={expiresLocal} class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm" /></label><input type="hidden" name="timezoneOffset" value={timezoneOffset} />{#if data.event.orderingEnabled}<label class="text-xs">Catalog<select name="catalogId" class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm">{#each data.catalogs as c (c.id)}<option value={c.id} selected={data.event.catalogId === c.id}>{c.name}</option>{/each}</select></label>{/if}</div></fieldset><fieldset class="settings-group"><legend>Downloads</legend><a class="mb-4 inline-block text-sm underline" href={`/admin/events/${data.event.id}/versions`}>Manage delivery versions & automatic copies</a><div class="grid gap-4 sm:grid-cols-3">{#each data.versions as role (role.key)}<label class="text-xs">{role.label}<select name={`p_${role.key}`} class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm"><option value="free" selected={data.event.variantPolicy[role.key] === 'free'}>Free</option><option value="disabled" selected={data.event.variantPolicy[role.key] !== 'free'}>Hidden</option></select></label>{/each}</div></fieldset><fieldset class="settings-group"><legend>Messages</legend>{#if data.event.orderingEnabled}<label class="mt-3 block text-xs">Print pickup / delivery instructions<textarea name="pickupInstructions" maxlength="2000" rows="3" placeholder="Where and how orders will be received" class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm">{data.event.pickupInstructions ?? ''}</textarea><span class="mt-1 block text-stone-500">Shown on order tracking pages and printed/delivered email updates.</span></label>{/if}<label class="mt-3 block text-xs">Gallery message · shown in the gallery and on confirmations<textarea name="parentMessage" maxlength="3000" rows="3" placeholder="Pickup plans, a contact detail, or a little hello…" class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm">{data.event.parentMessage ?? ''}</textarea></label><label class="mt-3 block text-xs">Private notes<textarea name="notes" rows="2" class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm">{data.event.notes ?? ''}</textarea></label></fieldset><fieldset class="settings-group"><legend>Publishing & orders</legend><div class="mt-3 flex flex-wrap gap-5 text-sm"><label class="flex items-center gap-2"><input name="orderingEnabled" type="checkbox" checked={!!data.event.orderingEnabled} /> Accept print orders</label><label class="flex items-center gap-2"><input name="isPublished" type="checkbox" checked={!!data.event.isPublished} /> Published and available to visitors</label></div><p class="mt-2 text-xs text-stone-500">Unpublish to close the project while keeping every photo and order. Only ready photos in active collections are shown to visitors.</p></fieldset><div class="project-save-bar"><button class="button-primary">Save project settings</button>{#if settingsDirty}<span class="text-xs text-stone-600" role="status">Unsaved changes</span>{/if}</div></form></div>
{#if data.event.orderingEnabled}<div id="project-pricing" role="tabpanel" aria-labelledby="project-tab-pricing" hidden={activePanel !== 'pricing'} tabindex="0" class="project-panel project-config"><h2 class="text-xl font-semibold">Print offerings & prices</h2><p class="mt-2 text-xs text-stone-500">Leave an override blank to follow the catalog. Past orders keep their accepted prices.</p><form method="post" action="?/overrides" oninput={() => pricingDirty = true} use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') pricingDirty = false; }} class="mt-3"><div class="grid gap-3 sm:grid-cols-2">{#each data.products as p (p.id)}<div class="rounded-xl border border-stone-200 p-3"><label class="flex gap-2 text-sm"><input type="checkbox" name={`active_${p.id}`} checked={p.eventActive} /><strong>{p.name}</strong></label><p class="mt-1 text-xs text-stone-500">Catalog: {formatCents(p.priceCents)} · Effective: {formatCents(p.overrideCents ?? p.priceCents)}{!p.active ? ' · inactive in catalog' : ''}</p><label class="mt-2 block text-xs">Project price override<input name={`price_${p.id}`} inputmode="decimal" value={p.overrideCents === null ? '' : (p.overrideCents / 100).toFixed(2)} placeholder="Follow catalog" class="mt-1 block w-full rounded-lg border border-stone-300 p-2" /></label></div>{/each}</div><div class="project-save-bar"><button class="button-primary">Save project prices</button>{#if pricingDirty}<span class="text-xs text-stone-600" role="status">Unsaved changes</span>{/if}</div></form><a href="/admin/catalog" class="mt-3 inline-block text-xs underline">Create or edit print packages →</a></div>{/if}
</div>

<dialog bind:this={previewDialog} use:dismissOnBackdrop aria-label="Photo preview" onclose={()=>previewId=null} class="fixed inset-0 m-auto max-h-[92dvh] w-[min(960px,94vw)] overflow-auto rounded-2xl border-0 p-4 shadow-xl backdrop:bg-black/70">
  <div class="mb-3 flex items-center gap-3"><h2 class="font-semibold">{preview?.displayName ?? 'Photo preview'}</h2><button type="button" class="ml-auto rounded-lg border border-stone-300 px-3 py-2 text-sm" onclick={() => previewDialog.close()}>Close</button></div>
  {#if preview}
    <PreviewFrame index={previewIndex} total={shown.length} items={shown.map(p=>({id:p.id,label:p.displayName,thumb:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash):undefined,preview:p.renditionStatus==='ready'?thumbUrl(p.id,p.renditionHash,'preview'):undefined}))} onselect={id=>previewId=Number(id)} onprevious={previewIndex >= 0 ? () => stepPreview(-1) : undefined} onnext={previewIndex >= 0 ? () => stepPreview(1) : undefined}>
      {#if preview.renditionStatus === 'ready'}<img src={thumbUrl(preview.id, preview.renditionHash, 'preview')} alt={preview.displayName} class="mx-auto max-h-[60dvh] w-full object-contain" />{:else}<p class="rounded-xl bg-stone-100 p-8 text-center text-sm text-stone-600">{preview.files.length ? 'A preview is not ready yet.' : 'The sidecars are safely stored. Add the matching RAW or finished JPEG for a preview.'}</p>{/if}
    </PreviewFrame>
    <button type="button" class="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white" onclick={() => toggle(preview.id)}>{selectedIds.includes(preview.id) ? 'Deselect photo' : 'Select this photo'}</button>
    {#if data.selected && !data.selected.isIntake && preview.renditionStatus==='ready'}<form method="post" action="?/setCover" use:enhance class="mt-3 inline-block"><input type="hidden" name="galleryId" value={data.selected.id} /><input type="hidden" name="photoId" value={preview.id} /><button class="button-secondary" disabled={data.selected.coverPhotoId===preview.id}>{data.selected.coverPhotoId===preview.id?'✓ Pinned cover':'Use as cover'}</button></form>{/if}
    <p class="mt-2 text-xs text-stone-500">{preview.collections.map((g) => g.name).join(' · ')}</p>
    <div class="mt-3 flex flex-wrap gap-2">{#each preview.files as f(f.id)}<span class="rounded-lg bg-stone-100 px-3 py-2 text-xs">{data.versions.find(v => v.key === f.role)?.label ?? f.role} · {formatBytes(f.bytes)}</span>{/each}{#if preview.collections.some(g=>!g.isIntake)}<button type="button" class="button-secondary" onclick={()=>copy(`${link}/p/${preview.id}`)}>Copy photo link</button>{/if}</div>
    {#if preview.sidecars.length}
      <section class="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-4" aria-label="Private Lightroom metadata">
        <h3 class="text-sm font-semibold">Lightroom details · only you</h3>
        <p class="mt-1 text-xs text-stone-600">These details help you sort. Your exported JPEG remains the finished photo; sidecars do not change what visitors see.</p>
        <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-stone-500">Rating</dt><dd>{previewMetadata?.rating === -1 ? 'Marked rejected in Lightroom' : previewMetadata?.rating ? `${previewMetadata.rating} stars` : 'Unrated'}</dd></div>
          {#if previewMetadata?.label}<div><dt class="text-xs text-stone-500">Color label</dt><dd class="break-words">{previewMetadata.label}</dd></div>{/if}
          {#if previewMetadata?.title}<div class="sm:col-span-2"><dt class="text-xs text-stone-500">Title</dt><dd class="break-words">{previewMetadata.title}</dd></div>{/if}
          {#if previewMetadata?.description}<div class="sm:col-span-2"><dt class="text-xs text-stone-500">Caption</dt><dd class="whitespace-pre-wrap break-words">{previewMetadata.description}</dd></div>{/if}
        </dl>
        {#if previewMetadata?.keywords.length}<p class="mt-3 text-xs text-stone-500">Keywords · tap one to find matching photos in this view</p><div class="mt-1 flex flex-wrap gap-2">{#each previewMetadata.keywords as keyword (keyword)}<button type="button" class="max-w-full break-words rounded-full border border-sky-200 bg-white px-3 py-1 text-xs text-sky-900" onclick={() => { keywordFilter = keyword; search = ''; ratingFilter = 'all'; filter = 'all'; previewDialog.close(); }}>{keyword}</button>{/each}</div>{/if}
        <ul class="mt-3 space-y-2 text-xs text-stone-600">{#each preview.sidecars as sidecar (sidecar.kind)}<li><span class="break-words font-medium">{sidecar.originalFilename}</span> · {formatBytes(sidecar.bytes)}{#if sidecar.metadataWarning}<p class="mt-1 text-amber-900">{sidecar.metadataWarning}</p>{/if}</li>{/each}</ul>
      </section>
    {/if}
    {#if preview.files.some((f) => f.role === 'raw')}
      <a href={`/admin/api/photos/${preview.id}/source-archive`} class="mt-4 inline-block rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold">Download RAW + sidecars</a>
      <p class="mt-1 text-xs text-stone-500">Private editing archive with matching filenames. Includes the current RAW{preview.sidecars.length ? ' and its uploaded companions' : '; no sidecars uploaded yet'}.</p>
    {:else if preview.sidecars.length}<p class="mt-4 text-sm text-amber-900">Add the matching RAW file to download the editing archive.</p>{/if}
  {/if}
</dialog>

{#if sortingBatch.length}<OrganizePhotos actorId={data.admin!.id} initial={recoveredDraft} eventId={data.event.id} photos={sortingBatch} galleries={data.galleries} onfinish={finishSorting} oncancel={() => {sortingBatch=[];recoveryRefresh++;}} />{/if}
{#if browsingCollectionKey}<CollectionBrowser eventId={data.event.id} collections={browseCollections} initialKey={browsingCollectionKey} onclose={()=>browsingCollectionKey=null} />{/if}

<style>
  .project-workspace { min-height: 85dvh; }
  .project-bar { position: sticky; top: 0; z-index: 30; background: #f6f7f5f5; backdrop-filter: blur(12px); border-bottom: 1px solid #d9ded7; }
  .project-tabs { display: flex; gap: .25rem; overflow-x: auto; }
  .project-tabs button { flex-shrink: 0; min-height: 44px; padding: .65rem 1rem; border-bottom: 3px solid transparent; color: #5e645c; font-size: .875rem; }
  .project-tabs button[aria-selected=true] { border-color: #285a4d; color: #203e35; font-weight: 650; }
  .project-tabs button:hover { background: #e9eee8; }
  .project-bar h1 { letter-spacing: -.035em; line-height: 1.2; }
  .organizer-photo { transition: box-shadow .16s ease, border-color .16s ease; }
  .organizer-photo:hover { box-shadow: 0 4px 14px #203e3512; }
  .collection-workspace > aside { padding-right: .75rem; }
  .collection-workspace :global(nav[aria-label="Photo collections"] a) { transition: background-color .16s ease, border-color .16s ease; }
  .collection-workspace :global(nav[aria-label="Photo collections"] a:hover) { background: #eef2ec; border-color: #acb9ab; }
  .project-config :global(input:focus), .project-config :global(select:focus), .project-config :global(textarea:focus) { border-color: #367d72; }
  .project-panel[hidden] { display: none; }
  .project-config { max-width: 68rem; margin: 1.25rem 0; padding: 1.5rem; border: 1px solid #e4e1d7; border-radius: 1rem; background: white; }
  .settings-group { margin-top: 1.5rem; padding: 1rem 0; border-top: 1px solid #e4e1d7; }
  .settings-group legend { padding-right: .75rem; font-size: .875rem; font-weight: 600; }
  .project-save-bar { position: sticky; bottom: 0; z-index: 10; display: flex; align-items: center; gap: 1rem; padding: .75rem 0; background: white; border-top: 1px solid #e4e1d7; }
  @media (max-width: 480px) { .project-tabs button { flex: 1; padding-inline: .4rem; } .project-config { padding: 1rem; } }
</style>
