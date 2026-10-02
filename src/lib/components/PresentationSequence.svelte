<script lang="ts">
  import { thumbUrl } from '$lib/client/api';
  let { items, order = $bindable(), label }: {
    items: {id:number; label:string; hash?:string|null}[]; order:number[]; label:string;
  } = $props();
  const byId = $derived(new Map(items.map(item => [item.id,item])));
  let announcement = $state('');
  function move(index:number, offset:number) {
    const next = [...order], target=index+offset;
    if (target<0 || target>=next.length) return;
    [next[index],next[target]]=[next[target],next[index]];
    order=next; announcement=`${byId.get(next[target])?.label} moved to position ${target+1}. Save to apply.`;
  }
</script>

<ol aria-label={label} class="max-h-96 space-y-2 overflow-auto rounded-xl border border-stone-200 p-2">
  {#each order as id,index (id)}
    {@const item=byId.get(id)}
    {#if item}
    <li class="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 p-2">
      <span class="w-7 shrink-0 text-center text-xs text-stone-500">{index+1}</span>
      {#if item.hash}<img src={thumbUrl(id,item.hash)} alt="" loading="lazy" class="h-12 w-12 shrink-0 rounded object-contain" />{/if}
      <span class="min-w-0 flex-1 break-words text-sm">{item.label}</span>
      <button type="button" class="button-secondary shrink-0 px-3" aria-label={`Move ${item.label} earlier`} disabled={index===0} onclick={()=>move(index,-1)}>↑</button>
      <button type="button" class="button-secondary shrink-0 px-3" aria-label={`Move ${item.label} later`} disabled={index===order.length-1} onclick={()=>move(index,1)}>↓</button>
    </li>
    {/if}
  {:else}<li class="p-4 text-sm text-stone-500">No photos yet.</li>{/each}
</ol>
<p aria-live="polite" class="sr-only">{announcement}</p>
