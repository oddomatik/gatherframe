<script lang="ts">
  import { enhance } from '$app/forms';
  import CollectionPresentation from './CollectionPresentation.svelte';
  import PresentationSequence from './PresentationSequence.svelte';
  let { layout, collections, eventId, dirty = $bindable(false) }:{layout:'directory'|'simple'|'sections';eventId:number;dirty?:boolean;collections:{id:number;name:string;publicTitle:string|null;publicDescription:string|null;photos:{id:number;label:string;hash:string|null}[]}[]}=$props();
  let order=$state<number[]>([]), selected=$state<number>(0);
  let selectedLayout=$state('directory'), collectionDirty=$state(false);
  const savedOrder=$derived(JSON.stringify(collections.map(c=>c.id)));
  $effect(()=>{order=JSON.parse(savedOrder);});
  $effect(()=>{selectedLayout=layout;});
  $effect(()=>{if(!collections.some(c=>c.id===selected))selected=collections[0]?.id??0;});
  $effect(()=>{dirty=collectionDirty||selectedLayout!==layout||JSON.stringify(order)!==savedOrder;});
  function chooseCollection(event: Event) {
    const select=event.currentTarget as HTMLSelectElement;
    if(collectionDirty&&!confirm('Switch collections without saving your collection changes?')) { select.value=String(selected);return; }
    collectionDirty=false;selected=Number(select.value);
  }
  const collection=$derived(collections.find(c=>c.id===selected));
</script>

<h2 class="text-xl font-semibold">Gallery presentation</h2>
<p class="mt-2 text-sm text-stone-600">Choose how guests explore this project. Layout changes do not publish photos, change access, or enable sales. Photos in To sort remain private.</p>
<form method="post" action="?/presentation" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="mt-5 rounded-xl border border-stone-200 bg-white p-4">
  <label class="block text-sm font-medium">Gallery layout
    <select aria-label="Gallery layout" name="galleryLayout" bind:value={selectedLayout} class="mt-2 block w-full rounded-lg border border-stone-300 p-3">
      <option value="directory">Collection directory — recognizable covers</option>
      <option value="simple">Simple gallery — straight to the photos</option>
      <option value="sections">Story / sections — named chapters</option>
    </select>
  </label>
  <p class="mt-3 text-xs text-stone-500">Simple galleries show all ready photos already filed in active collections, once each. Sections use the collection order below; empty collections stay hidden.</p>
  <button class="button-primary mt-4">Save gallery layout</button>
</form>
{#if collections.length}
  <details class="mt-5 rounded-xl border border-stone-200 bg-white p-4">
    <summary class="cursor-pointer font-medium">Collection display order</summary>
    <form method="post" action="?/collectionSequence" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="mt-3 space-y-3">
      <input type="hidden" name="expected" value={JSON.stringify(collections.map(c=>c.id))} />
      <input type="hidden" name="sequence" value={JSON.stringify(order)} />
      <PresentationSequence items={collections.map(c=>({id:c.id,label:c.publicTitle||c.name}))} bind:order label="Collection display sequence" />
      <p class="text-xs text-stone-500">Applies to the guest directory and story. Your studio sidebar remains name-sorted.</p>
      <button class="button-primary">Save collection order</button>
    </form>
  </details>
  <label class="mt-5 block text-sm font-medium">Edit collection
    <select aria-label="Edit collection" value={selected} onchange={chooseCollection} class="mt-2 block w-full rounded-lg border border-stone-300 p-3">{#each collections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select>
  </label>
  {#if collection}{#key collection.id}<CollectionPresentation {collection} {eventId} bind:dirty={collectionDirty} />{/key}{/if}
{:else}
  <p class="mt-5 rounded-xl bg-stone-100 p-4 text-sm">Create a collection in Photos and add the photos you want to share. Your uploads stay private until filed and the project is published.</p>
{/if}
