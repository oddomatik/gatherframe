<script lang="ts">
  import { activity } from '$lib/client/activity';
  import { onMount } from 'svelte';
  import { loadFamily,saveFamily,newPhotoCount, type FamilyState } from '$lib/client/family';
  import { toast } from '$lib/client/toast.svelte';
  import PublicTags from '$lib/components/PublicTags.svelte';
  import {tagQuery} from '$shared/tags';
  let {data}=$props();
  let family=$state<FamilyState>({pins:[],seen:{},positions:{}}), loaded=$state(false);
  onMount(()=>{family=loadFamily(data.event.id);loaded=true;const sync=()=>family=loadFamily(data.event.id);window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);});
  const pinned=$derived(data.galleries.filter(g=>family.pins.includes(g.publicId)));
  function pin(pid:string){try{family=saveFamily(data.event.id,s=>{s.pins=s.pins.includes(pid)?s.pins.filter(p=>p!==pid):[pid,...s.pins];});activity(data.event.slug,family.pins.includes(pid)?'family_add':'family_remove',{collection:pid});}catch{toast('This browser could not remember the collection. You can still use its link.','error');}}
  const filtered=$derived(data.selectedTags.length>0);
  function viewUrl(path=`/g/${data.event.slug}`){return path+tagQuery(data.selectedTags,data.tagMode);}
  function favoriteUrl(){const url=viewUrl(`/g/${data.event.slug}/browse`);return url+(url.includes('?')?'&':'?')+'favorites=1';}
</script>

<svelte:head><title>{data.event.name} · Photos</title></svelte:head>
<main class="album-home">
  <nav class="album-masthead"><span>{data.studio.name}</span><a href={favoriteUrl()} class="button-quiet">♡ Favorites</a></nav>
  <header class:with-image={!!data.heroUrl} class="album-hero">
    <div class="album-intro">
      <p class="eyebrow">Photo collection</p>
      <h1 class="display-title">{data.event.name}</h1>
      {#if data.event.tagline}<p class="album-tagline">{data.event.tagline}</p>{/if}
      <p class="album-count">{data.photoCount} photos <span aria-hidden="true">/</span> {data.galleries.length} collections</p>
      <div class="flex flex-wrap gap-2"><a class="button-primary" href="#collections">Explore collections ↓</a><a class="button-quiet" href={viewUrl(`/g/${data.event.slug}/browse`)}>{filtered?'Browse matching photos':'Browse all photos'} ↗</a></div>
    </div>
    {#if data.heroUrl}<figure class="album-hero-image"><picture>
      {#if data.heroSmallUrl}<source media="(max-width: 600px)" srcset={`${data.heroSmallUrl} 1x, ${data.heroUrl} 2x`} />{/if}
      <img src={data.heroUrl} srcset={data.heroLargeUrl ? `${data.heroUrl} 1x, ${data.heroLargeUrl} 2x` : undefined}
        width={data.heroWidth ?? undefined} height={data.heroHeight ?? undefined}
        alt={`${data.event.name} — project cover`} fetchpriority="high" decoding="async" />
      </picture><figcaption>{data.studio.name}</figcaption></figure>{/if}
  </header>
  {#if pinned.length}<section class="mb-8" aria-label="Saved collections"><div class="album-section-heading"><h2 class="display-title text-3xl">Saved collections</h2><span class="text-xs text-stone-500">Saved on this device</span></div><div class="grid grid-cols-2 gap-3 sm:grid-cols-4">{#each pinned as g}<a class="collection-tile block" href={viewUrl(`/g/${data.event.slug}/c/${g.publicId}`)} aria-label={`Open saved collection ${data.galleries.indexOf(g)+1}`}><img src={g.coverUrl??''} alt="Saved collection cover" class="h-36 w-full object-contain" /><div class="p-3 text-sm">Collection {String(data.galleries.indexOf(g)+1).padStart(2,'0')}{#if newPhotoCount(family,g.publicId,g.photoIds??[])}<span class="ml-2 font-semibold text-emerald-800">{newPhotoCount(family,g.publicId,g.photoIds??[])} new</span>{/if}</div></a>{/each}</div></section>{/if}
  <section id="collections" class="album-collections" aria-label="Photo collections">
    <div class="album-section-heading"><div><p class="eyebrow">The collections</p><h2 class="display-title">Find your photos</h2></div><span class="text-sm text-stone-500">{data.galleries.length} collections</span></div>
    <PublicTags tags={data.tags} selectedTags={data.selectedTags} tagMode={data.tagMode} path={`/g/${data.event.slug}`} base={`/g/${data.event.slug}`} />
    {#if !data.galleries.length}
      <div class="py-16 text-center"><h3 class="display-title text-3xl">{filtered?'No photos match these tags yet.':'Photos coming soon.'}</h3>{#if filtered}<a href={`/g/${data.event.slug}`} class="button-secondary mt-5">Show all photos</a>{/if}</div>
    {:else}
      <ul class="collection-grid parent-collection-grid">
        {#each data.galleries as g,i (g.id)}
          <li><a href={viewUrl(`/g/${data.event.slug}/c/${g.publicId}`)} class="collection-tile block" aria-label={`Open photo collection ${i+1}, ${g.photoCount} photos${filtered?' matching these tags':''}`}>
            <div class="collection-art">{#if g.coverUrl}<img src={g.coverUrl} alt={`Cover of photo collection ${i+1}`} loading="lazy" decoding="async" fetchpriority="low" />{/if}<span class="collection-open" aria-hidden="true">View photos ↗</span></div>
            <div class="collection-caption"><h3>Collection {String(i+1).padStart(2,'0')}</h3><span>{g.photoCount} photos ↗</span></div>
          </a><div class="mt-2 flex flex-wrap items-center justify-between gap-2"><button type="button" class="button-quiet text-sm" disabled={!loaded} aria-label={`${family.pins.includes(g.publicId)?'Unsave':'Save'} collection ${i+1}`} aria-pressed={family.pins.includes(g.publicId)} onclick={()=>pin(g.publicId)}>{family.pins.includes(g.publicId)?'★ Saved':'☆ Save collection'}</button>{#if newPhotoCount(family,g.publicId,g.photoIds??[])}<span class="text-xs font-medium text-emerald-800">{newPhotoCount(family,g.publicId,g.photoIds??[])} new since your visit</span>{/if}</div></li>
        {/each}
      </ul>
    {/if}
  </section>
  <footer class="album-footer"><span>{data.studio.name}</span>{#if data.studio.contact}<span>{data.studio.contact}</span>{/if}</footer>
</main>
