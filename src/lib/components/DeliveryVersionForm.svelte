<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, untrack } from 'svelte';
  import { formatBytes } from '$lib/client/api';
  import { DEFAULT_DELIVERY_RECIPE } from '$shared/delivery';
  import type { DeliveryVersion } from '$server/delivery';

  let { eventId, version, versions, access = 'disabled', samples, disabled = false }: {
    eventId: number; version?: DeliveryVersion; versions: DeliveryVersion[]; access?: string;
    samples: { id:number; label:string; roles:string[] }[]; disabled?: boolean
  } = $props();
  const initial = untrack(() => version?.recipe ?? DEFAULT_DELIVERY_RECIPE);
  let label = $state(untrack(() => version?.label ?? ''));
  let mode = $state(untrack(() => version?.mode ?? 'uploaded'));
  let sourceRole = $state(untrack(() => version?.sourceRole ?? 'print'));
  let sizeMode = $state(initial.width === initial.height ? 'edge' : 'box');
  let longEdge = $state(initial.width), width = $state(initial.width), height = $state(initial.height);
  let quality = $state(initial.quality), sharpening = $state(initial.sharpening), metadata = $state(initial.metadata);
  let sampleId = $state(''), previewUrl = $state(''), previewNote = $state(''), previewError = $state(''), busy = $state(false), fullSize = $state(false);
  let previewController: AbortController | undefined;
  function clearPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewNote = ''; }
  onDestroy(() => { previewController?.abort(); clearPreview(); });
  const sourceOptions = $derived(versions.filter(v => v.mode === 'uploaded' && v.key !== 'raw' && v.key !== version?.key));
  const sampleOptions = $derived(samples.filter(p => p.roles.includes(sourceRole)));
  async function preview() {
    previewController?.abort(); const controller = new AbortController(); previewController = controller;
    clearPreview(); previewError = ''; busy = true;
    try {
      const response = await fetch(`/admin/api/events/${eventId}/delivery-preview`, { method:'POST', signal:controller.signal,
        headers:{'content-type':'application/json'}, body:JSON.stringify({ photoId:Number(sampleId || sampleOptions[0]?.id), sourceRole,
          recipe:{ schema:1, width:sizeMode === 'edge' ? longEdge : width, height:sizeMode === 'edge' ? longEdge : height, quality, sharpening, metadata } }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || 'Could not create the preview.'); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      previewUrl = URL.createObjectURL(blob);
      previewNote = `${response.headers.get('x-image-width')} × ${response.headers.get('x-image-height')} px · ${formatBytes(blob.size)}`;
    } catch (err) { if (!controller.signal.aborted) previewError = err instanceof Error ? err.message : 'Could not preview.'; }
    finally { if (previewController === controller) busy = false; }
  }
</script>

<form method="post" action="?/save" use:enhance={() => async ({ result, update }) => { await update({ reset:false }); if (!version && result.type === 'success') label = ''; }} class="space-y-4">
  <fieldset disabled={disabled} class="space-y-4">
    {#if version}<input type="hidden" name="key" value={version.key} />{/if}
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="text-sm">Version name<input name="label" bind:value={label} required maxlength="60" placeholder="For example: Client proof" class="mt-1 block w-full rounded-lg border border-stone-300 p-2" /></label>
      <label class="text-sm">Supply this version<select name="mode" bind:value={mode} class="mt-1 block w-full rounded-lg border border-stone-300 p-2"><option value="uploaded">Use my exports</option>{#if version?.key !== 'print' && version?.key !== 'raw'}<option value="automatic">Create smaller copies</option>{/if}</select></label>
      <label class="text-sm">Guest downloads<select name="access" class="mt-1 block w-full rounded-lg border border-stone-300 p-2"><option value="disabled" selected={access === 'disabled'}>Hidden</option><option value="free" selected={access === 'free'}>Available</option>{#if access === 'paid'}<option value="paid" selected>Keep existing paid policy</option>{/if}</select></label>
      <label class="text-sm">Download filename<select name="filenameMode" class="mt-1 block w-full rounded-lg border border-stone-300 p-2"><option value="private" selected={version?.filenameMode !== 'original'}>Anonymous photo number</option><option value="original" selected={version?.filenameMode === 'original'}>Use uploaded filename</option></select></label>
      <label class="text-sm sm:col-span-2">Export folder name <span class="text-stone-500">(optional)</span><input name="folder" value={version?.folder ?? ''} maxlength="80" placeholder="For example: Client proofs" class="mt-1 block w-full rounded-lg border border-stone-300 p-2" /></label>
    </div>
    {#if mode === 'automatic'}
      <div class="rounded-xl bg-stone-50 p-4 space-y-4">
        <label class="block text-sm">Finished source<select name="sourceRole" bind:value={sourceRole} class="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2">{#each sourceOptions as source (source.key)}<option value={source.key}>{source.label}</option>{/each}</select></label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm">Size rule<select name="sizeMode" bind:value={sizeMode} class="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"><option value="edge">Maximum long edge</option><option value="box">Fit within width × height</option></select></label>
          {#if sizeMode === 'edge'}<label class="text-sm">Long edge (pixels)<input name="longEdge" type="number" min="320" max="8192" step="1" list="delivery-sizes" bind:value={longEdge} required class="mt-1 block w-full rounded-lg border border-stone-300 p-2" /></label>
          {:else}<div class="grid grid-cols-2 gap-2"><label class="text-sm">Width (px)<input name="width" type="number" min="320" max="8192" bind:value={width} required class="mt-1 w-full rounded-lg border border-stone-300 p-2" /></label><label class="text-sm">Height (px)<input name="height" type="number" min="320" max="8192" bind:value={height} required class="mt-1 w-full rounded-lg border border-stone-300 p-2" /></label></div>{/if}
        </div>
        <p class="text-xs text-stone-600">JPEG · sRGB · keeps proportions · never enlarges or crops.</p>
        <details><summary class="cursor-pointer text-sm">Quality & metadata</summary><div class="mt-3 grid gap-3 sm:grid-cols-3">
          <label class="text-sm">JPEG quality<input name="quality" type="number" min="50" max="95" bind:value={quality} class="mt-1 w-full rounded-lg border border-stone-300 p-2" /></label>
          <label class="text-sm">Extra sharpening<select name="sharpening" bind:value={sharpening} class="mt-1 w-full rounded-lg border border-stone-300 p-2"><option value="none">None</option><option value="screen">Light screen sharpening</option></select></label>
          <label class="text-sm">Metadata<select name="metadata" bind:value={metadata} class="mt-1 w-full rounded-lg border border-stone-300 p-2"><option value="none">Remove metadata</option><option value="copyright">Keep artist & copyright only</option></select></label>
        </div><p class="mt-2 text-xs text-stone-600">Uploaded exports are unchanged. These settings apply only to copies made here; sharpening is not Lightroom’s algorithm.</p></details>
        <div class="border-t border-stone-200 pt-3">
          {#if sampleOptions.length}<label class="text-sm">Preview photo<select aria-label={`Preview photo for ${label || 'new version'}`} bind:value={sampleId} class="ml-2 max-w-full rounded-lg border border-stone-300 p-2"><option value="">{sampleOptions[0].label}</option>{#each sampleOptions.slice(1) as p (p.id)}<option value={p.id}>{p.label}</option>{/each}</select></label><button type="button" class="button-quiet mt-2" disabled={busy} onclick={preview}>{busy ? 'Preparing…' : 'Preview these settings'}</button>
          {:else}<p class="text-xs text-stone-600">Upload a source JPEG to preview these settings.</p>{/if}
          {#if previewError}<p role="alert" class="mt-2 text-sm text-red-800">{previewError}</p>{/if}
          {#if previewUrl}<div class="mt-3"><div class="flex flex-wrap justify-between gap-2 text-xs"><span>{previewNote}</span><label><input type="checkbox" bind:checked={fullSize} /> 100% detail</label></div><div class="mt-2 max-h-96 overflow-auto rounded-lg border border-stone-200 bg-white"><img src={previewUrl} alt="Generated delivery preview" class={fullSize ? 'max-w-none' : 'max-h-96 w-full object-contain'} /></div><p class="mt-2 text-xs text-stone-500">Preview only. Change settings and preview again before saving.</p></div>{/if}
        </div>
      </div>
    {:else}<p class="text-sm text-stone-600">Files are delivered exactly as you upload them. Set dimensions, sharpening and rendering in Lightroom or your editor.</p>{/if}
    <button class="button-primary">{version ? 'Save version' : 'Add version'}</button>
  </fieldset>
</form>
