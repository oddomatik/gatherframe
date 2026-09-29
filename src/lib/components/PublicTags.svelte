<script lang="ts">
  import { goto } from '$app/navigation';
  import { tagPath,tagTree,tagQuery,type PhotoTag } from '$shared/tags';
  import { toast } from '$lib/client/toast.svelte';
  let {tags,selectedTags,tagMode,path,base}: {tags:(PhotoTag&{count:number})[];selectedTags:string[];tagMode:'any'|'all';path:string;base:string}=$props();
  let expanded = $state(false);
  const panelId = $props.id();
  function toggle(id:string){void goto(path+tagQuery(selectedTags.includes(id)?selectedTags.filter(n=>n!==id):[...selectedTags,id],tagMode),{noScroll:true,keepFocus:true});}
  async function copy(){try{await navigator.clipboard.writeText(new URL(path+tagQuery(selectedTags,tagMode),location.origin).href);toast('Link copied.','success');}catch{toast('Copy the address from your browser.','error');}}
</script>
{#if tags.length || selectedTags.length}<section class="public-tag-panel mb-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="Browse by tags">
  <button type="button" class="mobile-tag-toggle" aria-expanded={expanded} aria-controls={panelId} onclick={() => expanded = !expanded}>Filters{selectedTags.length ? ` · ${selectedTags.length} active` : ''}<span aria-hidden="true">{expanded?'−':'+'}</span></button>
  <div id={panelId} class="public-tag-options" class:expanded>
  <div class="flex flex-wrap items-center gap-3"><h2 class="font-semibold">Find your moments</h2><a href={path} class="button-quiet text-xs">Clear filters</a><label class="text-xs ml-auto">Combine <select aria-label="Match tags" value={tagMode} onchange={e=>goto(path+tagQuery(selectedTags,e.currentTarget.value==='all'?'all':'any'),{noScroll:true})} class="rounded border p-2"><option value="any">Match any</option><option value="all">Match all</option></select></label></div>
  <div class="mt-3 flex flex-wrap gap-2">{#each tagTree(tags) as t(t.id)}<button class={selectedTags.includes(t.publicId)?'button-primary text-xs':'button-secondary text-xs'} aria-pressed={selectedTags.includes(t.publicId)} onclick={()=>toggle(t.publicId)}>{tagPath(tags,t.id)} · {tags.find(n=>n.id===t.id)?.count}</button>{/each}</div>
  {#if selectedTags.length}<div class="mt-3 flex flex-wrap gap-3 text-xs"><button class="underline" onclick={copy}>Copy link to this view</button><a class="underline" href={base+'/browse'+tagQuery(selectedTags,tagMode)}>See matching photos across collections</a></div>{/if}
  </div>
</section>{/if}
