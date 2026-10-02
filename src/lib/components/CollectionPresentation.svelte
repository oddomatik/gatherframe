<script lang="ts">
  import { enhance } from '$app/forms';
  import PresentationSequence from './PresentationSequence.svelte';
  let { collection, eventId, dirty = $bindable(false) }: { collection:{id:number;name:string;publicTitle:string|null;publicDescription:string|null;photos:{id:number;label:string;hash:string|null}[]}; eventId:number; dirty?:boolean }=$props();
  let order=$state<number[]>([]), title=$state(''), description=$state('');
  const saved=$derived(JSON.stringify({order:collection.photos.map(p=>p.id),title:collection.publicTitle??'',description:collection.publicDescription??''}));
  $effect(()=>{const snapshot=JSON.parse(saved);order=snapshot.order;title=snapshot.title;description=snapshot.description;});
  $effect(()=>{dirty=JSON.stringify({order,title,description})!==saved;});
</script>
<form method="post" action="?/collectionPresentation" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="mt-4 space-y-4 rounded-xl border border-stone-200 bg-white p-4">
  <input type="hidden" name="galleryId" value={collection.id} />
  <input type="hidden" name="expected" value={JSON.stringify(collection.photos.map(p=>p.id))} />
  <input type="hidden" name="sequence" value={JSON.stringify(order)} />
  <h3 class="font-semibold">Collection presentation</h3>
  <p class="text-sm text-stone-600">Private label: <strong>{collection.name}</strong>. This label stays in your studio.</p>
  <label class="block text-sm">Public title <span class="text-stone-500">(optional)</span><input name="publicTitle" maxlength="120" bind:value={title} placeholder="For example, The ceremony" class="mt-1 block w-full rounded-lg border border-stone-300 p-2" /></label>
  <label class="block text-sm">Public description <span class="text-stone-500">(optional)</span><textarea name="publicDescription" maxlength="2000" rows="3" bind:value={description} class="mt-1 block w-full rounded-lg border border-stone-300 p-2"></textarea></label>
  <p class="text-xs text-stone-500">Only text entered here is shown to guests. Leave blank to keep anonymous collection titles. A collection link is not a separate access restriction.</p>
  <h4 class="text-sm font-semibold">Photo sequence</h4>
  <p class="text-xs text-stone-500">Reorder this collection without changing the same photos elsewhere. New photos appear after your saved sequence.</p>
  <PresentationSequence items={collection.photos} bind:order label="Collection photo sequence" />
  <div class="flex flex-wrap gap-3">
    <button class="button-primary">Save collection presentation</button>
    <button class="button-secondary" name="reset" value="1">Restore automatic photo order</button>
    <a class="button-quiet" href={`/admin/events/${eventId}?g=${collection.id}`}>Choose cover & manage photos →</a>
  </div>
</form>
