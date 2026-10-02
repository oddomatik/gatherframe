<script lang="ts">
  import { tagQuery, type PhotoTag } from '$shared/tags';
  import PublicTags from './PublicTags.svelte';
  import type { PublicPhoto } from '$server/public';
  let { data }:{data:{event:{slug:string;name:string;tagline:string|null};studio:{name:string};heroUrl:string|null;selectedTags:string[];tagMode:'any'|'all';tags:(PhotoTag & {count:number})[];photos:PublicPhoto[];galleries:{id:number;publicId:string;publicTitle:string|null;publicDescription:string|null;photoIds:number[];photoCount:number}[]}}=$props();
  const byId=$derived(new Map(data.photos.map(p=>[p.id,p])));
  const query=$derived(tagQuery(data.selectedTags,data.tagMode));
</script>

<main class="album-home">
  <header class="mb-8">
    <p class="eyebrow">{data.studio.name}</p>
    <h1 class="display-title mt-3 text-4xl sm:text-6xl">{data.event.name}</h1>
    {#if data.event.tagline}<p class="mt-3 text-stone-600">{data.event.tagline}</p>{/if}
    {#if data.heroUrl}<img src={data.heroUrl} alt={`${data.event.name} — project cover`} class="mt-6 max-h-[60vh] w-full rounded-xl object-contain" />{/if}
  </header>
  <nav aria-label="Gallery sections" class="mb-6 flex flex-wrap gap-3">
    {#each data.galleries as gallery,index (gallery.id)}<a class="button-secondary" href={`#section-${gallery.publicId}`}>{gallery.publicTitle || `Collection ${String(index+1).padStart(2,'0')}`}</a>{/each}
    <a class="button-quiet" href={`/g/${data.event.slug}/browse${query}`}>Browse all photos →</a>
  </nav>
  <PublicTags tags={data.tags} selectedTags={data.selectedTags} tagMode={data.tagMode} path={`/g/${data.event.slug}`} base={`/g/${data.event.slug}`} />
  {#each data.galleries as gallery,index (gallery.id)}
    <section id={`section-${gallery.publicId}`} aria-label={gallery.publicTitle || `Collection ${index+1}`} class="scroll-mt-6 border-t border-stone-200 py-10">
      <h2 class="display-title text-3xl">{gallery.publicTitle || `Collection ${String(index+1).padStart(2,'0')}`}</h2>
      {#if gallery.publicDescription}<p class="mt-3 max-w-3xl whitespace-pre-line break-words text-stone-600">{gallery.publicDescription}</p>{/if}
      <p class="mt-2 text-sm text-stone-500">{gallery.photoCount} photos</p>
      <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {#each gallery.photoIds.slice(0,12) as id (id)}
          {@const photo=byId.get(id)}
          {#if photo}<a href={`/g/${data.event.slug}/c/${gallery.publicId}${query}${query?'&':'?'}photo=${id}`} aria-label={`Open photo ${id} in ${gallery.publicTitle || `collection ${index+1}`}`}><img src={photo.urls.preview} alt={`Photo ${id}`} loading="lazy" class="aspect-[4/3] w-full rounded-lg bg-stone-100 object-contain" /></a>{/if}
        {/each}
      </div>
      <a class="button-primary mt-5" href={`/g/${data.event.slug}/c/${gallery.publicId}${query}`}>View all {gallery.photoCount} photos →</a>
    </section>
  {:else}
    <p class="py-10 text-stone-500">{data.selectedTags.length?'No photos match these tags yet.':'Photos coming soon.'}</p>
  {/each}
</main>
