<script lang="ts">
  import { groupPrints, type PrintSlot } from '$shared/prints';
  import type { Catalog } from '$shared/catalog';
  import { photoUrl, type PhotoPresentation } from '$lib/client/photos';
  let { slots, photos, catalog, quantity = 1 }: { slots: PrintSlot[]; photos: Record<number, PhotoPresentation>; catalog?: Catalog; quantity?: number } = $props();
  const groups = $derived(groupPrints(slots, catalog));
</script>
<div class="mt-3 space-y-3">
  {#each groups as group (group.key)}
    <div class="rounded-xl bg-stone-50 p-3"><div class="mb-2 flex items-center justify-between gap-2 text-sm"><span class="font-semibold">{group.label}</span><span class="text-stone-600">{group.count * quantity} print{group.count * quantity === 1 ? '' : 's'}</span></div>
      <div class="flex flex-wrap gap-2">
        {#each group.prints as slot (slot.sheetIdx + ':' + slot.cellIndex)}
          <div class="relative w-20 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {#if slot.photoId && photos[slot.photoId]}<img src={photoUrl(photos[slot.photoId])} alt={`${group.label}: selected photo`} class="h-24 w-full object-contain" loading="lazy" />{:else}<div class="flex h-24 items-center justify-center p-2 text-center text-xs text-stone-500">{slot.photoId ? 'Preview unavailable' : 'Choose a photo'}</div>{/if}
            <span class="block border-t border-stone-100 py-1 text-center text-xs text-stone-600">{quantity} cop{quantity === 1 ? 'y' : 'ies'}</span>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>
