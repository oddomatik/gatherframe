<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import DeliveryVersionForm from '$lib/components/DeliveryVersionForm.svelte';
  import { formatBytes } from '$lib/client/api';
  let { data, form } = $props();
  let statusLimits = $state<Record<string,number>>({});
  const active = $derived(data.overview.some(s => ['queued','processing'].includes(s.status)));
  onMount(() => { const timer = setInterval(() => { if (active && !document.hidden) void invalidateAll(); }, 5000); return () => clearInterval(timer); });
  const names = $derived(Object.fromEntries(data.versions.map(v => [v.key,v.label])));
</script>
<svelte:head><title>Delivery versions · {data.event.name}</title></svelte:head>
<a href={`/admin/events/${data.event.id}`} class="text-sm text-stone-500 hover:underline">← {data.event.name}</a>
<header class="my-6"><p class="eyebrow">{data.event.name}</p><h1 class="display-title mt-2 text-4xl sm:text-5xl">Delivery versions</h1><p class="mt-3 max-w-2xl text-stone-600">Use your exports, create smaller copies, or mix both. Your original files stay unchanged.</p></header>
{#if form?.error}<p role="alert" class="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{form.error}</p>{/if}
{#if form?.ok}<p role="status" class="mb-4 rounded-xl bg-green-50 p-4 text-green-900">{form.ok}</p>{/if}
<datalist id="delivery-sizes"><option value="1280"></option><option value="1920"></option><option value="2048"></option><option value="2560"></option><option value="3840"></option></datalist>
<div class="space-y-4">
  {#each data.versions as v (v.key)}
    {@const states = data.overview.filter(s => s.role === v.key)}
    {@const actionable = states.filter(s => s.needsReview || ['failed','waiting','paused','queued','processing'].includes(s.status) || v.mode === 'automatic' && s.origin === 'uploaded')}
    {@const candidates = data.backfills[v.key] ?? []}
    <section class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6" aria-label={`${v.label} version`}>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{v.label}</h2><span class="text-sm text-stone-500">{v.mode === 'automatic' ? `Automatic from ${names[v.sourceRole ?? ''] ?? 'source'}` : 'Photographer exports'}</span></div>
      {#if v.key === 'print'}<p class="mb-4 text-xs text-stone-500">This version supplies print production. Renaming it does not change approved orders.</p>{/if}
      <details><summary class="cursor-pointer text-sm font-medium">Edit version</summary><div class="mt-4"><DeliveryVersionForm eventId={data.event.id} version={v} versions={data.versions} access={data.event.variantPolicy[v.key]} samples={data.samples} disabled={data.demo} /></div></details>
      {#if v.mode === 'automatic'}
        <div class="mt-5 border-t border-stone-200 pt-4">
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={`${v.label} processing status`}>
            <span>{states.filter(s => s.status === 'ready').length} ready</span><span>{states.filter(s => ['queued','processing'].includes(s.status)).length} processing</span><span>{states.filter(s => s.origin === 'uploaded').length} uploaded overrides</span><span>{states.filter(s => s.status === 'failed').length} need attention</span>
          </div>
          {#if states.some(s => ['queued','processing','waiting','failed'].includes(s.status))}<form method="post" action="?/pauseBatch" use:enhance class="mt-3"><input type="hidden" name="key" value={v.key} /><button class="button-quiet" disabled={data.demo}>Pause all pending copies</button></form>{/if}
          {#if candidates.length}<details class="mt-4"><summary class="cursor-pointer text-sm">Review generation for {candidates.length} existing photos</summary><form method="post" action="?/batch" use:enhance class="mt-3 space-y-3"><input type="hidden" name="key" value={v.key} /><p class="text-sm text-stone-600">Up to 500 copies per batch. Uploaded overrides and paused photos are excluded.</p><div class="max-h-48 overflow-auto rounded-lg border border-stone-200 p-3">{#each candidates.slice(0,500) as p (p.photoId)}<label class="flex items-center gap-2 py-1 text-sm"><input name="photoId" type="checkbox" value={p.photoId} checked disabled={data.demo} />{p.name}</label>{/each}</div><label class="block text-sm"><input name="reviewed" value="yes" type="checkbox" required disabled={data.demo} /> Generate the selected copies using this version’s saved settings</label><button class="button-primary" disabled={data.demo}>Generate selected copies</button></form></details>{/if}
        </div>
      {/if}
      {#if actionable.length}
        <details class="mt-4"><summary class="cursor-pointer text-sm">Photo status & overrides</summary><div class="mt-3 space-y-3">
          {#each actionable.slice(0,statusLimits[v.key] ?? 100) as s (`${s.photoId}:${s.role}`)}
            <div class="rounded-xl bg-stone-50 p-3 text-sm"><div class="flex flex-wrap justify-between gap-2"><strong>{s.name}</strong><span>{s.status}{s.width && s.height ? ` · ${s.width} × ${s.height} px` : ''}{s.bytes ? ` · ${formatBytes(s.bytes)}` : ''}</span></div>
              {#if s.error}<p class="mt-1 text-amber-900">{s.error}</p>{/if}
              {#if s.needsReview}<p class="mt-1 text-amber-900">The source changed. Review this uploaded export; its bytes are unchanged.</p>{/if}
              <form method="post" action="?/photo" use:enhance class="mt-2 flex flex-wrap items-center gap-3"><input type="hidden" name="photoId" value={s.photoId} /><input type="hidden" name="key" value={v.key} />
                {#if s.needsReview}<button name="intent" value="review" class="underline" disabled={data.demo}>Keep this uploaded version</button>{/if}
                {#if v.mode === 'automatic' && s.origin !== 'uploaded'}<button name="intent" value="retry" class="underline" disabled={data.demo || ['queued','processing'].includes(s.status)}>Retry / resume automatic</button>{/if}
                {#if ['queued','processing','waiting','failed'].includes(s.status)}<button name="intent" value="pause" class="underline" disabled={data.demo}>Pause processing</button>{/if}
              </form>
              {#if v.mode === 'automatic' && s.origin === 'uploaded'}<details class="mt-2"><summary class="cursor-pointer text-xs">Replace this override with an automatic copy</summary><form method="post" action="?/photo" use:enhance class="mt-2 space-y-2"><input type="hidden" name="photoId" value={s.photoId} /><input type="hidden" name="key" value={v.key} /><input type="hidden" name="intent" value="retry" /><input type="hidden" name="expectedSha256" value={s.sha256 ?? ''} /><label class="block text-xs"><input type="checkbox" name="replaceUpload" value="yes" required disabled={data.demo} /> Replace this uploaded version when the automatic copy is ready</label><button class="button-quiet" disabled={data.demo}>Resume automatic copy</button></form></details>{/if}
            </div>
          {/each}
          {#if actionable.length > (statusLimits[v.key] ?? 100)}<button type="button" class="button-quiet" onclick={() => statusLimits[v.key] = (statusLimits[v.key] ?? 100) + 100}>Show more photo statuses</button>{/if}
        </div></details>
      {/if}
    </section>
  {/each}
  <details class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6"><summary class="cursor-pointer text-lg font-semibold">Add a delivery version</summary><div class="mt-4"><DeliveryVersionForm eventId={data.event.id} versions={data.versions} samples={data.samples} disabled={data.demo} /></div></details>
  <details class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6"><summary class="cursor-pointer text-sm font-medium">Gallery display source</summary><form method="post" action="?/display" use:enhance class="mt-4 space-y-3"><label class="text-sm">Make gallery previews from<select name="displaySourceRole" class="mt-1 block w-full rounded-lg border border-stone-300 p-2"><option value="" selected={!data.event.displaySourceRole}>Automatic: full resolution first</option>{#each data.versions.filter(v => v.mode === 'uploaded') as v (v.key)}<option value={v.key} selected={data.event.displaySourceRole === v.key}>{v.label}</option>{/each}</select></label><p class="text-xs text-stone-600">If absent, another uploaded version is used. This only changes browsing previews, never downloadable files.</p><button class="button-quiet" disabled={data.demo}>Save & refresh previews</button></form></details>
</div>
