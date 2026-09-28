<script lang="ts">
  import { thumbUrl } from '$lib/client/api';
  let { collections, eventId, onbrowse }: {
    collections: { id:number; name:string; photoCount:number; coverThumbId:number|null; coverHash:string|null }[];
    eventId:number; onbrowse:(key:string)=>void;
  } = $props();
  let search = $state('');
  const visible = $derived(collections.filter(c => c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
</script>

<section aria-label="Collection overview" class="collection-overview">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div><p class="eyebrow">Your project, organized</p><h2 class="display-title mt-2 text-3xl sm:text-4xl">Collections <span class="text-xl text-stone-500">{collections.length}</span></h2></div>
    <input type="search" aria-label="Search collection overview" placeholder="Find a collection…" bind:value={search} class="min-w-0 rounded-lg border border-stone-200 px-4 py-3 text-sm" />
  </header>
  <div class="collection-grid">
    {#each visible as c (c.id)}
      <article class="collection-tile">
        <button type="button" class="collection-art" onclick={()=>onbrowse(String(c.id))} aria-label={`View photos in ${c.name}`}>
          {#if c.coverThumbId}<img src={thumbUrl(c.coverThumbId,c.coverHash)} alt={c.name} loading="lazy" decoding="async" />{:else}<span class="empty-cover">No photos yet</span>{/if}
          <span class="collection-open" aria-hidden="true">View photos ↗</span>
        </button>
        <div class="collection-caption"><h3>{c.name}</h3><span>{c.photoCount} photos</span></div>
        <a class="collection-edit" href={`/admin/events/${eventId}?g=${c.id}`}>Open collection →</a>
      </article>
    {/each}
  </div>
  {#if !visible.length}<p class="py-16 text-center text-stone-500">{collections.length?'No matching collections.':'Create a collection while organizing your photos.'}</p>{/if}
</section>
