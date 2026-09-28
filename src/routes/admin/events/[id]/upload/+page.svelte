<script lang="ts">
  import { isAcceptedUpload, type UploadRole, type VariantRole } from '$shared/stem';
  import { photoKey } from '$shared/photo-key';
  import { compareShotNames } from '$shared/photo-order';
  import {tagTree,tagPath} from '$shared/tags';
  import { findImportMatches, planImportFiles, sameImportBytes, sourceFolder, type ImportPhoto } from '$shared/import-plan';
  import { api, formatBytes } from '$lib/client/api';
  import { toast } from '$lib/client/toast.svelte';
  import { clientUuid } from '$lib/client/ids';
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import {uploadFile} from '$lib/client/resumable-upload';
  import PreviewFrame from '$lib/components/PreviewFrame.svelte';
  import { dismissOnBackdrop } from '$lib/client/dialog-backdrop';

  let { data } = $props();
  type Entry = { file: File; status: 'queued' | 'uploading' | 'done' | 'unchanged' | 'error'; progress: number; stage?: string; bytes?: number; error?: string; preview?: string };
  type Row = { key: string; stem: string; stemOverride?: string; galleryId: number; files: Partial<Record<UploadRole, Entry>> };
  type Conflict = { key: string; rowKey: string; file: File; role: UploadRole };
  type Remembered = { stemOverride: string };
  let rows = $state<Row[]>([]);
  let reviewOpen = $state(false);
  const orderedRows = $derived([...rows].sort((a, b) => compareShotNames(a.stem, b.stem) || compareShotNames(a.stemOverride ?? '', b.stemOverride ?? '') || a.key.localeCompare(b.key)));
  let inspectKey = $state<string | null>(null);
  let importPreview: HTMLDialogElement;
  const inspectIndex = $derived(orderedRows.findIndex(row => row.key === inspectKey));
  const inspectRow = $derived(inspectIndex >= 0 ? orderedRows[inspectIndex] : null);
  function inspect(row: Row) { inspectKey = row.key; importPreview.showModal(); }
  function stepImport(direction: number) { if (orderedRows.length && inspectIndex >= 0) inspectKey = orderedRows[(inspectIndex + direction + orderedRows.length) % orderedRows.length].key; }
  $effect(() => { if (inspectKey && !inspectRow) importPreview?.close(); });
  let conflicts = $state<Conflict[]>([]);
  let conflictReviewOpen = $state(false);
  let galleryId = $state<number>(untrack(() => data.initialGallery ?? data.galleries[0]?.id ?? 0));
  let unsuffixedRole = $state<VariantRole>('print');
  let running = $state(false);
  let adding = $state(false);
  let selectionNote = $state('');
  let checkingFiles = $state(0);
  let disposed = false;
  let pauseRequested = false;
  let replaceExisting = $state(false);
  let uploadTags=$state<number[]>([]);
  let tagsLocked = $state(false);
  let previousImport = $state('');
  let existing = $state<ImportPhoto[]>([]);
  let inventoryReady = $state(false);
  let inventoryError = $state(false);
  let inventoryRequest = 0;
  const activeRequests = new Set<AbortController>();
  const previewUrls = new Set<string>();
  let remembered: Record<string, Remembered> = {};
  const imageRoles: VariantRole[] = ['print', 'social', 'raw'];
  const roles: UploadRole[] = [...imageRoles, 'xmp', 'acr'];
  const roleLabels: Record<UploadRole, string> = { print: 'Full resolution', social: 'Social copy', raw: 'Camera RAW', xmp: 'XMP', acr: 'ACR' };
  const zones: { role: VariantRole; label: string; help: string }[] = [
    { role: 'print', label: 'Full resolution', help: 'Your finished Lightroom JPEGs' },
    { role: 'social', label: 'Social copies', help: 'Optional smaller downloads' },
    { role: 'raw', label: 'Camera RAW + edit files', help: 'Optional originals, XMP and ACR sidecars' }
  ];
  const manifestKey = $derived(`picture-day-import-${data.admin?.id ?? "signed-out"}-${data.event.id}`);
  const total = $derived(rows.reduce((n, r) => n + Object.keys(r.files).length, 0));
  const done = $derived(rows.reduce((n, r) => n + Object.values(r.files).filter((f) => f && ['done', 'unchanged'].includes(f.status)).length, 0));
  const errors = $derived(rows.reduce((n, r) => n + Object.values(r.files).filter((f) => f?.status === 'error').length, 0));
  const replacing = $derived(rows.reduce((n, r) => n + Object.keys(r.files).filter((role) => hasExisting(r, role as UploadRole)).length, 0));
  const ambiguous = $derived(rows.filter((r) => matches(r).length > 1));
  const missingFull = $derived(inventoryReady ? rows.filter((r) => !r.files.print && !hasExisting(r, 'print')).length : 0);
  const folderSummary = $derived.by(() => {
    const groups = new Map<string, { path: string; role: UploadRole; count: number }>();
    for (const row of rows) for (const role of roles) {
      const entry = row.files[role]; if (!entry) continue;
      const path = sourceFolder(entry.file.webkitRelativePath || entry.file.name).path || 'Selected files';
      const key = JSON.stringify([path, role]);
      const group = groups.get(key) ?? { path, role, count: 0 }; group.count++; groups.set(key, group);
    }
    return [...groups.values()];
  });
  const conflictGroups = $derived.by(() => {
    const groups = new Map<string, { key: string; queuedPath: string; incomingPath: string; role: UploadRole; items: Conflict[] }>();
    for (const conflict of conflicts) {
      const queued = rows.find((r) => r.key === conflict.rowKey)?.files[conflict.role];
      const queuedPath = sourceFolder(queued?.file.webkitRelativePath || queued?.file.name || '').path || 'Selected files';
      const incomingPath = sourceFolder(conflict.file.webkitRelativePath || conflict.file.name).path || 'Selected files';
      const key = JSON.stringify([queuedPath, incomingPath, conflict.role]);
      const group = groups.get(key) ?? { key, queuedPath, incomingPath, role: conflict.role, items: [] };
      group.items.push(conflict); groups.set(key, group);
    }
    return [...groups.values()];
  });
  const fingerprint = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
  function matches(row: Row) { return findImportMatches(existing, row.stem, row.stemOverride); }
  function isSidecar(role: UploadRole) { return role === 'xmp' || role === 'acr'; }
  function hasExisting(row: Row, role: UploadRole) {
    const found = matches(row);
    if (found.length !== 1) return false;
    return isSidecar(role) ? found[0].sidecars?.some((file) => file.kind === role) ?? false : found[0].files.some((file) => file.role === role);
  }
  function hasImage(row: Row) { return imageRoles.some((role) => row.files[role] || hasExisting(row, role)); }
  function hasSidecars(row: Row) { return !!row.files.xmp || !!row.files.acr || hasExisting(row, 'xmp') || hasExisting(row, 'acr'); }
  function displayName(row: Row) { return Object.values(row.files)[0]?.file.name.replace(/\.[^.]+$/, '') ?? row.stem; }
  function preview(row: Row) { return row.files.social?.preview ?? row.files.print?.preview; }
  function saveManifest() {
    try {
      for (const row of rows) for (const entry of Object.values(row.files)) if (entry && row.stemOverride) remembered[fingerprint(entry.file)] = { stemOverride: row.stemOverride };
      localStorage.setItem(manifestKey, JSON.stringify({ version: 2, total, done, entries: remembered, uploadTags, tagsLocked }));
    } catch { /* Import remains usable with browser storage disabled. */ }
  }
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(manifestKey) || 'null');
      // Older manifests included folder-dependent identities: never reuse those for normal matching.
      if (saved?.version === 2 && saved.entries) remembered = saved.entries;
      if (saved?.version === 2 && saved.total > saved.done) {
        uploadTags = Array.isArray(saved.uploadTags) ? saved.uploadTags.filter((id:number)=>data.tags.some(t=>t.id===id)) : []; if(saved.shootDay) { const legacy=data.tags.find(t=>t.legacyDay===Number(saved.shootDay)); if(legacy) uploadTags=[legacy.id]; } tagsLocked = saved.tagsLocked === true || saved.dayLocked === true;
      }
      if (saved && saved.total > saved.done) previousImport = `Your last import transferred ${saved.done} of ${saved.total} files. Reselect the same folder to resume received chunks and skip identical files before transfer. Partial files are kept for 7 days; your browser does not retain the source files.`;
    } catch { /* Optional recovery. */ }
    void loadExisting().catch(() => {});
    return () => { disposed = true; for (const xhr of activeRequests) xhr.abort(); for (const url of previewUrls) URL.revokeObjectURL(url); };
  });
  beforeNavigate(({ cancel }) => { if ((running || adding || total > done || conflicts.length) && !confirm('Some files have not finished uploading. Leave this page? You can reselect the same files to retry later.')) cancel(); });
  async function loadExisting() {
    const request = ++inventoryRequest;
    inventoryReady = false; inventoryError = false;
    try {
      const result = await api<{ photos: ImportPhoto[] }>(`/admin/api/events/${data.event.id}/photos?import=1`);
      if (request === inventoryRequest) { existing = result.photos; inventoryReady = true; }
    } catch (error) { if (request === inventoryRequest) { existing = []; inventoryError = true; } throw error; }
  }
  function makeEntry(file: File): Entry {
    let url: string | undefined;
    if (/\.(jpe?g|png|webp|avif|gif)$/i.test(file.name)) { url = URL.createObjectURL(file); previewUrls.add(url); }
    return { file, status: 'queued', progress: 0, preview: url };
  }
  function releaseEntry(entry?: Entry) {
    if (entry?.preview) { URL.revokeObjectURL(entry.preview); previewUrls.delete(entry.preview); }
  }
  async function queueFile(file: File, role: UploadRole, stemOverride?: string, destination = galleryId): Promise<boolean> {
    if (disposed) return false;
    const stem = photoKey(file.name);
    const override = stemOverride ?? remembered[fingerprint(file)]?.stemOverride;
    let row = rows.find((r) => r.stem === stem && r.stemOverride === override);
    if (row?.files[role]) {
      const queued = row.files[role]!;
      // Every file selection creates new browser File objects, even for the same
      // source. Compare bytes before presenting a decision or retransferring it.
      try {
        if (await sameImportBytes(queued.file, file)) return false;
        if (disposed) return false;
        for (const candidate of conflicts.filter((c) => c.rowKey === row!.key && c.role === role)) {
          if (await sameImportBytes(candidate.file, file)) return false;
          if (disposed) return false;
        }
      } catch { /* Unreadable files remain visible for review/reselection. */ }
      if (disposed) return false;
      conflicts.push({ key: clientUuid(), file, rowKey: row.key, role }); return true;
    }
    if (!row) { row = { key: clientUuid(), stem, stemOverride: override, galleryId: destination, files: {} }; rows.push(row); }
    row.files[role] = makeEntry(file); return true;
  }
  async function addFiles(files: FileList | File[], zoneRole: VariantRole | null) {
    if (running || adding) return;
    adding = true; checkingFiles = 0; replaceExisting = false;
    let repeated = 0, skipped = 0;
    try {
      const accepted = Array.from(files).filter((file) => {
        if (isAcceptedUpload(file.name)) return true;
        skipped++; return false;
      });
      const planned = planImportFiles(accepted, zoneRole, unsuffixedRole);
      // Choose the initial layout once, before this batch starts appearing.
      // Progress, inventory refreshes and later file additions must not undo
      // the user's own disclosure choice.
      if (!rows.length && planned.size) reviewOpen = planned.size <= 12;
      for (const entries of planned.values()) for (const { file, role } of entries) {
        if (!await queueFile(file, role)) repeated++;
        if (disposed) return;
        checkingFiles++;
      }
      selectionNote = [repeated ? `${repeated} identical file${repeated === 1 ? '' : 's'} already selected — kept once.` : '', skipped ? `${skipped} unsupported file${skipped === 1 ? '' : 's'} skipped.` : ''].filter(Boolean).join(' ');
      saveManifest();
    } finally { adding = false; }
  }
  function clearSelection() {
    if (running || adding) return;
    if (total > done && !confirm('Clear the selected files? Nothing already uploaded will be deleted.')) return;
    for (const row of rows) for (const entry of Object.values(row.files)) releaseEntry(entry);
    rows = []; conflicts = []; replaceExisting = false; selectionNote = ''; previousImport = ''; uploadTags=[]; tagsLocked = false; saveManifest();
  }
  function canUseGroup(items: Conflict[]) {
    return new Set(items.map((c) => c.rowKey)).size === items.length;
  }
  function resolveGroup(items: Conflict[], incoming: boolean) {
    if (running || adding || (incoming && !canUseGroup(items))) return;
    if (incoming) for (const conflict of items) useCopy(conflict);
    else { const keys = new Set(items.map((c) => c.key)); conflicts = conflicts.filter((c) => !keys.has(c.key)); saveManifest(); }
  }
  function keepBoth(conflict: Conflict) {
    replaceExisting = false;
    const row = rows.find((r) => r.key === conflict.rowKey);
    void queueFile(conflict.file, conflict.role, `${photoKey(conflict.file.name).slice(0, 140)}~${clientUuid().slice(0, 8)}`, row?.galleryId);
    conflicts = conflicts.filter((c) => c.key !== conflict.key); saveManifest();
  }
  function useCopy(conflict: Conflict) {
    replaceExisting = false;
    const row = rows.find((r) => r.key === conflict.rowKey);
    if (row) { releaseEntry(row.files[conflict.role]); row.files[conflict.role] = makeEntry(conflict.file); }
    conflicts = conflicts.filter((c) => c.key !== conflict.key); saveManifest();
  }
  function separateRow(row: Row) {
    replaceExisting = false;
    row.stemOverride = `${row.stem.slice(0, 140)}~${clientUuid().slice(0, 8)}`;
    for (const entry of Object.values(row.files)) if (entry) { entry.status = 'queued'; entry.progress = 0; entry.error = undefined; }
    saveManifest();
  }
  function skipRow(row: Row) { for (const entry of Object.values(row.files)) releaseEntry(entry); replaceExisting = false; rows = rows.filter((r) => r.key !== row.key); conflicts = conflicts.filter((c) => c.rowKey !== row.key); saveManifest(); }
  function fillVacatedRole(row: Row, role: UploadRole) {
    const next = conflicts.find((c) => c.rowKey === row.key && c.role === role);
    if (next) {
      row.files[role] = makeEntry(next.file);
      conflicts = conflicts.filter((c) => c.key !== next.key);
    }
  }
  function remove(row: Row, role: UploadRole) {
    replaceExisting = false; releaseEntry(row.files[role]); delete row.files[role];
    fillVacatedRole(row, role);
    if (!Object.keys(row.files).length) skipRow(row);
    saveManifest();
  }
  function setRole(row: Row, from: UploadRole, to: VariantRole) {
    if (isSidecar(from) || from === to || !row.files[from]) return;
    if (row.files[to]) { toast('That photo already has this version in the queue. Nothing changed.', 'error'); return; }
    replaceExisting = false;
    row.files[to] = row.files[from]; delete row.files[from]; fillVacatedRole(row, from); saveManifest();
  }
  let sentBytes = $state(0), speed = $state(0);
  let startedAt = 0;
  const allEntries = $derived(rows.flatMap(r=>Object.values(r.files).filter((e):e is Entry=>!!e)));
  const totalBytes = $derived(allEntries.reduce((n,e)=>n+e.file.size,0));
  const receivedBytes = $derived(allEntries.reduce((n,e)=>n+(['done','unchanged'].includes(e.status)?e.file.size:(e.bytes??0)),0));
  const remainingBytes = $derived(Math.max(0,totalBytes-receivedBytes));
  const etaMinutes = $derived(speed>0?Math.ceil(remainingBytes/speed/60):0);
  async function put(row:Row,role:UploadRole) {
    const entry=row.files[role]!, controller=new AbortController();activeRequests.add(controller);
    entry.status='uploading';entry.error=undefined;
    let sent=0;
    try {
      const result=await uploadFile(data.event.id,entry.file,{galleryId:row.galleryId,role,replacement:replaceExisting?'replace':'reject',stemOverride:row.stemOverride,tagIds:[...uploadTags]},controller.signal,p=>{
        entry.stage=p.stage;entry.bytes=p.bytes;entry.progress=p.bytes/entry.file.size;
        sentBytes+=Math.max(0,p.sent-sent);sent=p.sent;
        speed=sentBytes/Math.max(1,(Date.now()-startedAt)/1000);
      });
      entry.status=result.status==='unchanged'?'unchanged':'done';entry.progress=1;entry.bytes=entry.file.size;
    } catch(err) {entry.status=controller.signal.aborted?'queued':'error';entry.error=err instanceof Error?err.message:'Could not confirm upload. Retry safely.';}
    finally {activeRequests.delete(controller);saveManifest();}
  }
  async function start() {
    if (running || adding) return;
    if (conflicts.length) { toast('Review the overlapping files first.', 'error'); return; }
    running = true; pauseRequested = false; sentBytes=0;speed=0;startedAt=Date.now();
    try {
      await loadExisting();
      if (ambiguous.length) { toast('More than one saved photo matches a filename. Skip that row or keep it as a separate photo.', 'error'); return; }
      const queue: [Row, UploadRole][] = [];
      for (const role of ['print','social','xmp','acr','raw'] as UploadRole[]) for (const row of orderedRows) if (row.files[role] && !['done', 'unchanged'].includes(row.files[role]!.status)) queue.push([row, role]);
      if (queue.length) { tagsLocked = true; saveManifest(); }
      await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length && !pauseRequested) { const [row, role] = queue.shift()!; await put(row, role); } }));
      // Refresh from the server rather than leaving version badges based on pre-upload state.
      await loadExisting().catch(() => {});
      const uploadedImages = rows.some((row) => imageRoles.some((role) => row.files[role]));
      toast(pauseRequested ? 'Paused. Finished files are safe; retry unfinished files whenever you’re ready.' : errors ? `${errors} file(s) need attention. The rest are transferred.` : uploadedImages ? 'Files transferred! Image previews are being prepared; Lightroom edit files stay private.' : 'Lightroom edit files saved privately. Your exported JPEGs are unchanged.', errors ? 'error' : 'success');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not check existing photos. Please retry.', 'error'); }
    finally { running = false; if (done === total) replaceExisting = false; saveManifest(); }
  }
  function pause() { pauseRequested = true; for (const xhr of activeRequests) xhr.abort(); }
  function onInput(event: Event, role: VariantRole | null) { const input = event.currentTarget as HTMLInputElement; if (input.files) void addFiles(input.files, role); input.value = ''; }
</script>

<svelte:window onbeforeunload={(event) => { if (running || adding || total > done || conflicts.length) { event.preventDefault(); event.returnValue = ''; } }} />
<svelte:head><title>Bring in photos · {data.event.name}</title></svelte:head>
<a href={`/admin/events/${data.event.id}`} class="text-sm text-stone-500 hover:underline">← Back to {data.event.name}</a>
<header class="import-heading"><p class="eyebrow">{data.event.name}</p><h1 class="display-title mt-2 text-4xl sm:text-5xl">Upload photos</h1></header>

{#if previousImport}<p class="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{previousImport}</p>{/if}
<div class="mt-5 flex flex-wrap items-end gap-4 rounded-2xl border border-stone-200 bg-white p-4">
  <label class="text-sm">New photos go to<select bind:value={galleryId} onchange={(event) => { const destination = Number(event.currentTarget.value); for (const row of rows) row.galleryId = destination; }} disabled={running || adding} class="mt-1 block rounded-xl border border-stone-300 px-3 py-2">{#each data.galleries as gallery (gallery.id)}<option value={gallery.id}>{gallery.name}{gallery.isIntake ? ' (private)' : ''}</option>{/each}</select></label>
  <details><summary class="cursor-pointer text-sm">Tags for new photos (optional) · {uploadTags.length} selected</summary><div class="mt-2 max-h-48 overflow-y-auto">{#each tagTree(data.tags) as t(t.id)}<label class="flex items-center gap-2 text-sm p-1"><input type="checkbox" value={t.id} bind:group={uploadTags} onchange={saveManifest} disabled={running||adding||tagsLocked} />{tagPath(data.tags,t.id)}</label>{/each}{#if !data.tags.length}<p class="text-xs">Create project tags on the event page, or tag photos after uploading.</p>{/if}</div></details>
</div>
{#if tagsLocked}<p class="mt-2 text-xs text-stone-500">Batch tags are locked for retry.</p>{/if}
<section class="import-dropzone" aria-label="Import export folder">
  <h2 class="text-lg font-semibold">Add your export folder</h2>
  <p class="mt-2 text-sm text-stone-600"><strong>full/</strong> · <strong>social/</strong> · <strong>raw/</strong><span class="ml-3">Matched by filename.</span></p>
  <label class="mt-4 inline-block cursor-pointer rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white">Choose folder<input aria-label="Choose export parent folder" type="file" multiple webkitdirectory disabled={running || adding} class="sr-only" onchange={(event) => onInput(event, null)} /></label>
  <details class="mt-3 text-xs text-stone-600"><summary class="cursor-pointer">Other folder names</summary><label class="mt-2 block">Unrecognized image folders contain <select bind:value={unsuffixedRole} disabled={running || adding} class="rounded border border-stone-300 bg-white px-2 py-1"><option value="print">full resolution</option><option value="social">social copies</option></select></label><p class="mt-1">Applies to the next selection. Recognized full/, social/, and raw/ folders always use their named version.</p></details>
</section>
<details class="mt-4"><summary class="cursor-pointer text-sm font-semibold">Add separate folders or files</summary>
<div class="mt-3 grid gap-3 sm:grid-cols-3">
  {#each zones as { role, label, help } (role)}
    <section class="rounded-2xl border-2 border-dashed border-stone-300 bg-white p-4 text-center" aria-label={label} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); if (!running && !adding && event.dataTransfer?.files) void addFiles(event.dataTransfer.files, role); }}>
      <h2 class="font-semibold">{label}</h2><p class="mt-1 text-xs text-stone-500">{help}</p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <label class="cursor-pointer rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white">Choose folder<input aria-label={`Choose ${label.toLowerCase()} folder`} type="file" multiple webkitdirectory disabled={running || adding} class="sr-only" onchange={(event) => onInput(event, role)} /></label>
        <label class="cursor-pointer rounded-lg border border-stone-300 px-3 py-2 text-xs">Choose files<input aria-label={`Choose ${label.toLowerCase()} files`} type="file" multiple disabled={running || adding} class="sr-only" accept={role === 'raw' ? 'image/*,.cr2,.cr3,.nef,.arw,.dng,.raf,.rw2,.orf,.pef,.tif,.tiff,.heic,.xmp,.acr' : 'image/*,.cr2,.cr3,.nef,.arw,.dng,.raf,.rw2,.orf,.pef,.tif,.tiff,.heic'} onchange={(event) => onInput(event, role)} /></label>
      </div><p class="mt-3 text-[11px] text-stone-400">Or drop files here</p>
    </section>
  {/each}
</div>
</details>
<details class="mt-4 text-xs text-stone-600"><summary class="cursor-pointer py-2">Import details</summary><ul class="mt-2 space-y-2 pl-4 list-disc"><li>Matching filenames become one photo. Existing collections and links stay intact.</li><li>Missing versions can be added later. Nothing is deleted.</li><li>XMP and ACR companions stay private. Finished JPEGs are what parents see.</li><li>Destination and batch tags apply to new photos only.</li></ul></details>
{#if inventoryError}<div class="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Could not check saved photos. Your selected files are still here. <button type="button" disabled={running || adding} class="underline" onclick={() => void loadExisting().catch(() => {})}>Check again</button>. Uploading will check again before transferring anything.</div>{/if}
{#if adding}<p class="mt-4 rounded-xl bg-sky-50 p-3 text-sm" role="status">Checking selected files… {checkingFiles} checked. Repeated copies are compared automatically.</p>{/if}
{#if selectionNote}<p class="mt-4 rounded-xl bg-sky-50 p-3 text-sm" role="status">{selectionNote}</p>{/if}
{#if conflicts.length}
  <section class="conflict-summary" aria-label="File conflicts">
    <div><h2 class="font-semibold">{conflicts.length} file conflicts</h2><p class="mt-1 text-sm text-stone-600">Review overlapping copies before uploading.</p></div>
    <button type="button" class="button-secondary" aria-expanded={conflictReviewOpen} aria-controls="conflict-review" onclick={()=>conflictReviewOpen=!conflictReviewOpen}>{conflictReviewOpen?'Close review':'Review conflicts'}</button>
  </section>
  <section id="conflict-review" hidden={!conflictReviewOpen} class="conflict-review" aria-label="Review conflicting files">
    <header><h2 class="text-lg font-semibold">Choose the source to keep</h2><p class="mt-1 text-sm text-stone-600">These decisions affect this upload queue only.</p></header>
    {#each conflictGroups as group (group.key)}
      <div class="mt-4 rounded-xl bg-white p-4">
        <h3 class="font-semibold">{group.items.length} {roleLabels[group.role]} conflict{group.items.length === 1 ? '' : 's'}</h3>
        <p class="mt-2 break-all text-xs"><strong>Queued folder:</strong> {group.queuedPath}</p>
        <p class="mt-1 break-all text-xs"><strong>Incoming folder:</strong> {group.incomingPath}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={running || adding} class="rounded-lg border border-stone-300 px-3 py-2 text-sm" onclick={() => resolveGroup(group.items, false)}>Keep queued folder</button>
          <button type="button" disabled={running || adding || !canUseGroup(group.items)} class="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-40" onclick={() => resolveGroup(group.items, true)}>Use incoming folder</button>
        </div>
        {#if !canUseGroup(group.items)}<p class="mt-2 text-xs">Some photos have several incoming alternatives. Review those below before choosing an incoming copy.</p>{/if}
        <details class="mt-3"><summary class="cursor-pointer text-sm underline">Review individual files ({group.items.length})</summary>
          {#each group.items as conflict (conflict.key)}
            {@const queued = rows.find((r) => r.key === conflict.rowKey)?.files[conflict.role]}
            <div class="mt-3 rounded-lg border border-stone-200 p-3 text-xs">
              <p class="break-all"><strong>Queued:</strong> {queued?.file.webkitRelativePath || queued?.file.name} · {formatBytes(queued?.file.size ?? 0)}</p>
              <p class="mt-1 break-all"><strong>Incoming:</strong> {conflict.file.webkitRelativePath || conflict.file.name} · {formatBytes(conflict.file.size)}</p>
              <div class="mt-2 flex flex-wrap gap-3"><button type="button" disabled={running || adding} class="underline" onclick={() => useCopy(conflict)}>Use incoming copy</button><button type="button" disabled={running || adding} class="underline" onclick={() => keepBoth(conflict)}>Keep as separate photo</button><button type="button" disabled={running || adding} class="underline" onclick={() => resolveGroup([conflict], false)}>Keep queued copy</button></div>
            </div>
          {/each}
        </details>
      </div>
    {/each}
  </section>
{/if}
{#if rows.length}
  <section class="mt-5">
    <div class="sticky top-0 z-10 rounded-xl border border-stone-200 bg-white/95 p-3 backdrop-blur">
      <div class="flex flex-wrap items-center gap-3"><h2 class="font-semibold">{rows.length} photos · {total} files</h2><span class="text-sm text-stone-500">{done} transferred{errors ? ` · ${errors} need attention` : ''}</span>{#if running}<button type="button" class="ml-auto rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm" onclick={pause}>Pause uploads</button>{:else}<button type="button" class="ml-auto rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" onclick={start} disabled={adding || done === total || !!conflicts.length || !!ambiguous.length}>{errors || done ? 'Retry unfinished files' : 'Upload files'}</button>{/if}</div>
      <progress aria-label="Upload bytes received" value={receivedBytes} max={totalBytes} class="mt-2 block h-1.5 w-full accent-emerald-700"></progress>
      <p class="mt-2 text-xs text-stone-600">{formatBytes(receivedBytes)} of {formatBytes(totalBytes)} · {formatBytes(remainingBytes)} remaining{#if running && speed>0} · {formatBytes(speed)}/s · about {etaMinutes || 1} min left{/if}</p><p class="mt-1 text-xs text-stone-500">JPEGs first · interrupted transfers resume · files count as transferred after verification.</p>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-3"><span class="flex-1"></span><button type="button" class="text-sm underline" disabled={running || adding} onclick={clearSelection}>Clear selection</button></div>
    <ul class="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Selected folders">{#each folderSummary as folder (`${folder.path}:${folder.role}`)}<li class="rounded-xl border border-stone-200 bg-white p-3 text-sm"><strong class="break-all">{folder.path}</strong><span class="mt-1 block text-stone-600">{folder.count} {roleLabels[folder.role]} file{folder.count === 1 ? '' : 's'}{#if isSidecar(folder.role)} · Private{/if}</span></li>{/each}</ul>
    {#if replacing}<div class="mt-3 rounded-xl bg-sky-50 p-3 text-sm"><p>{replacing} versions already uploaded. Identical files are skipped; changed files need your permission.</p><label class="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" bind:checked={replaceExisting} disabled={running || adding} /> Update existing versions in this batch</label><p class="mt-1 text-xs text-sky-800">Replaces changed versions everywhere this photo appears.</p></div>{/if}
    {#if missingFull}<p class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{missingFull} photos are missing full-resolution files. You can add them later.</p>{/if}
    <details class="mt-4" bind:open={reviewOpen}><summary class="cursor-pointer text-sm font-semibold">Review {rows.length} photos and their versions</summary>
    <div class="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white"><table class="w-full text-left text-sm"><thead><tr class="bg-stone-50 text-xs text-stone-500"><th class="p-3" scope="col">Photo</th>{#each roles as role (role)}<th class="p-3" scope="col">{roleLabels[role]}{#if isSidecar(role)}<span class="mt-1 block font-normal text-violet-700">Private edit file</span>{/if}</th>{/each}</tr></thead><tbody>
      {#each orderedRows as row (row.key)}
        {@const found = matches(row)}
        <tr class="border-t border-stone-100 align-top"><td class="p-3"><div class="flex gap-3">{#if preview(row)}<button type="button" aria-label={`Preview import photo ${displayName(row)}`} onclick={() => inspect(row)} class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100 focus-visible:outline-2 focus-visible:outline-amber-600"><img src={preview(row)} alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" /></button>{/if}<div class="min-w-32"><button type="button" class="break-all text-left text-xs font-semibold hover:underline" aria-label={`Inspect import photo ${displayName(row)}`} onclick={() => inspect(row)}>{displayName(row)}</button>
          {#if !inventoryReady}<p class="mt-1 text-xs text-stone-500">{inventoryError ? 'Saved versions not checked' : 'Checking saved versions…'}</p>
          {:else if found.length > 1}<p class="mt-1 text-xs font-medium text-amber-800">Matches {found.length} saved photos. Choose Keep separate or skip this row.</p>
          {:else if found.length === 1}<p class="mt-1 text-xs text-sky-800">Linked to existing photo</p><p class="mt-1 text-xs text-stone-500">{found[0].collections.map((g) => `${g.name}${g.isArchived ? ' (archived)' : ''}`).join(' · ') || 'Existing collections unchanged'}</p>
          {:else}<p class="mt-1 text-xs text-stone-500">{row.stemOverride ? 'Separate photo' : 'New photo'} → {data.galleries.find((g) => g.id === row.galleryId)?.name ?? 'To sort'}</p>{/if}
          {#if inventoryReady && hasSidecars(row) && !hasImage(row)}<p class="mt-2 text-xs font-medium text-amber-800">Awaiting a photo · edit files stay private</p>
          {:else if !row.files.print && inventoryReady && !hasExisting(row, 'print')}<p class="mt-2 text-xs font-medium text-amber-800">Awaiting full-resolution file</p>{/if}
          {#if inventoryReady && hasSidecars(row) && !row.files.raw && !hasExisting(row, 'raw')}<p class="mt-1 max-w-52 text-xs text-stone-500">No matching RAW yet. Add it later with the same filename.</p>{/if}
          {#if found.length > 1 || Object.values(row.files).some((f) => f?.status === 'error')}<button type="button" disabled={running || adding} class="mt-2 text-xs underline" onclick={() => separateRow(row)}>Keep as a separate photo</button>{/if}
          <button type="button" disabled={running || adding} class="mt-2 block text-xs text-stone-500 underline" onclick={() => skipRow(row)}>Remove from queue</button>
        </div></div></td>
          {#each roles as role (role)}{@const entry = row.files[role]}<td class="p-3">{#if entry}<div class={`min-w-36 rounded-lg p-2 text-xs ${entry.status === 'error' ? 'bg-red-50 text-red-900' : ['done', 'unchanged'].includes(entry.status) ? 'bg-emerald-50 text-emerald-900' : isSidecar(role) ? 'bg-violet-50' : 'bg-stone-50'}`}><p class="break-all">{entry.file.name}</p><p class="mt-1 text-[10px] text-stone-500">{formatBytes(entry.file.size)}{#if isSidecar(role)} · Private{/if}</p>
            {#if entry.status === 'uploading'}<progress value={entry.progress} max="1" class="mt-2 w-full" aria-label={`Uploading ${entry.file.name}`}></progress><span class="text-xs">{entry.stage ?? 'Uploading'}</span>
            {:else if entry.status === 'error'}<p class="mt-2 break-words">{entry.error}</p>
            {:else if entry.status === 'done' || entry.status === 'unchanged'}<p class="mt-2">✓ {entry.status === 'unchanged' ? 'Unchanged · already uploaded' : 'Transferred'}</p>
            {:else}<div class="mt-2 flex items-center gap-2">{#if isSidecar(role)}<span class="text-[10px] text-violet-800">{roleLabels[role]} sidecar</span>{:else}<select aria-label={`Version of ${entry.file.name}`} value={role} onchange={(event) => setRole(row, role, event.currentTarget.value as VariantRole)} disabled={running || adding} class="max-w-28 rounded border border-stone-300 text-[10px]"><option value="print">Full resolution</option><option value="social">Social</option><option value="raw">RAW</option></select>{/if}<button type="button" disabled={running || adding} class="ml-auto underline" onclick={() => remove(row, role)}>Remove</button></div>{/if}
          </div>{:else if hasExisting(row, role)}<span class={`text-xs ${isSidecar(role) ? 'text-violet-700' : 'text-sky-700'}`}>✓ {isSidecar(role) ? 'Saved privately' : 'Already uploaded'}</span>{:else}<span class="text-xs text-stone-400">{!inventoryReady ? 'Not checked' : role === 'print' ? 'Not yet uploaded' : 'Optional · not uploaded'}</span>{/if}</td>{/each}
        </tr>
      {/each}
    </tbody></table></div></details>
    {#if done}<a href={`/admin/events/${data.event.id}`} class="mt-4 inline-block rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold">Organize photos →</a>{/if}
  </section>
{/if}

<dialog bind:this={importPreview} use:dismissOnBackdrop aria-label="Import photo preview" onclose={() => inspectKey = null} class="fixed inset-0 m-auto max-h-[92dvh] w-[min(1000px,94vw)] overflow-auto rounded-2xl border-0 bg-white p-4 shadow-xl backdrop:bg-black/70">
  <div class="mb-3 flex items-center justify-between gap-3"><h2 class="break-words text-sm font-semibold">{inspectRow ? displayName(inspectRow) : 'Photo preview'}</h2><button type="button" class="button-secondary shrink-0" onclick={() => importPreview.close()}>Close</button></div>
  {#if inspectRow}
    <PreviewFrame index={inspectIndex} total={orderedRows.length} items={orderedRows.map(row=>({id:row.key,label:displayName(row),thumb:preview(row),preview:row.files.print?.preview??preview(row)}))} onselect={id=>inspectKey=String(id)} onprevious={() => stepImport(-1)} onnext={() => stepImport(1)}>
      {#if preview(inspectRow)}<img src={inspectRow.files.print?.preview ?? preview(inspectRow)} alt={displayName(inspectRow)} class="max-h-[70dvh] w-full object-contain" decoding="async" />{:else}<p class="rounded-xl bg-stone-100 px-14 py-16 text-center text-sm text-stone-500">No JPEG preview in this row.</p>{/if}
    </PreviewFrame>
  {/if}
</dialog>
