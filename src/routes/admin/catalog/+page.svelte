<script lang="ts">
  import { enhance } from '$app/forms';
  import SheetDiagram from '$lib/components/SheetDiagram.svelte';
  import { toast } from '$lib/client/toast.svelte';
  import { contentsSummary } from '$shared/catalog';
  let { data, form } = $props();
  $effect(() => { if (form?.ok) toast(String(form.ok), 'success'); if (form?.error) toast(String(form.error), 'error'); });
</script>

<div class="flex items-center gap-3">
  <h1 class="text-2xl font-semibold">Catalog</h1>
  <form method="post" action="?/reseed" use:enhance class="ml-auto"><button class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">Add missing starter offerings</button></form>
</div>
<p class="mt-1 text-sm text-stone-600">Choose print sizes and quantities; you handle final crops, paper and printing. Each event can use its own prices.</p>

<details class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
  <summary class="cursor-pointer font-semibold">+ Create a print offering</summary>
  <form method="post" action="?/create" use:enhance class="mt-4">
    <div class="grid gap-3 sm:grid-cols-3"><label class="text-xs">Name<input name="name" required placeholder="Print bundle" class="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" /></label><label class="text-xs">Price $<input name="price" required inputmode="decimal" placeholder="0.00" class="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" /></label><label class="text-xs">Description<input name="description" placeholder="Two display prints and four small prints" class="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" /></label></div>
    <h2 class="mt-4 text-sm font-semibold">What’s included?</h2><div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{#each data.catalog.printSizes as size (size.code)}<label class="text-xs">{size.label}<input name={`qty_${size.code}`} type="number" min="0" max="50" step="1" value="0" class="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" /></label>{/each}</div><p class="mt-3 text-xs text-stone-600">Enter how many prints of each size. Customers can choose a different photo for each one. Existing orders keep their original contents.</p><button class="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white">Create offering</button>
  </form>
</details>
<section class="mt-4 space-y-3">
  {#each data.catalog.products as p (p.id)}
    <form method="post" action="?/save" use:enhance class="grid gap-3 rounded-xl border border-stone-200 bg-white p-3 md:grid-cols-[auto_1fr_auto]">
      <input type="hidden" name="id" value={p.id} />
      <div class="flex h-16 gap-1">
        {#each p.sheets as s (s.templateCode)}
          {@const tpl = data.catalog.sheets[s.templateCode]}
          {#if tpl}<div style={`width:${Math.round(64 * (tpl.paperWidthIn / tpl.paperHeightIn))}px`}><SheetDiagram sheet={tpl} sizes={data.catalog.printSizes} showLabels={false} /></div>{/if}
        {/each}
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="text-xs">Name<input name="name" value={p.name} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm" /></label>
        <label class="text-xs">Description<input name="description" value={p.description ?? ''} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm" /></label>
        <div class="text-xs text-stone-500 sm:col-span-2">{p.kind} · {contentsSummary(p, data.catalog)} · sheets: {p.sheets.map((s) => s.templateCode).join(', ')}</div>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs md:w-64">
        <label>Price $<input name="price" value={(p.priceCents / 100).toFixed(2)} inputmode="decimal" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm" /></label>
        <label>Cost $<input name="cost" value={data.costs[p.id] == null ? '' : (data.costs[p.id]! / 100).toFixed(2)} placeholder="optional" inputmode="decimal" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm" /></label>
        <label>Sort<input name="sortOrder" value={p.sortOrder} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm" /></label>
        <div class="flex flex-col justify-end gap-1">
          <label class="flex items-center gap-1"><input type="checkbox" name="active" checked={p.active} /> active</label>
          <label class="flex items-center gap-1"><input type="checkbox" name="multi" checked={p.allowMultiPose} /> mixed poses</label>
        </div>
        <button class="col-span-2 rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white">Save</button>
      </div>
    </form>
    <form method="post" action="?/duplicate" use:enhance class="text-right"><input type="hidden" name="id" value={p.id} /><button class="text-xs text-stone-600 underline">Duplicate {p.name}</button></form>
  {/each}
</section>

<details class="mt-8">
  <summary class="cursor-pointer text-sm font-semibold">Internal layout reference</summary><p class="mt-2 text-xs text-stone-500">Reference only. Final crop and print layout are yours to decide.</p>
  <div class="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
    {#each Object.values(data.catalog.sheets) as tpl (tpl.code)}
      <div><SheetDiagram sheet={tpl} sizes={data.catalog.printSizes} /><p class="mt-1 text-xs text-stone-600">{tpl.label} <span class="text-stone-400">({tpl.code})</span></p></div>
    {/each}
  </div>
</details>
