<script lang="ts">
 import {onMount} from 'svelte';
 import {api} from '$lib/client/api';
 import {readDraft,writeDraft,draftKey,type DraftRecord} from '$lib/client/sorting-drafts';
 let {actorId,eventId,onresume,onundo,refresh=0}: {actorId:number;eventId:number;onresume:(r:DraftRecord)=>void;onundo:()=>void;refresh?:number}=$props();
 let saved=$state<DraftRecord|null>(null),action=$state<{id:string;photos:number}|null>(null),message=$state(''),busy=$state(false);
 async function load(){try{saved=await readDraft(draftKey(actorId,eventId));}catch{message='Device draft recovery is unavailable in this browser.';}try{action=(await api<{action:typeof action}>(`/admin/api/events/${eventId}/organize/undo`)).action;}catch{/* owner can retry when online */}}
 onMount(()=>{void load();const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('picture-day-drafts');if(channel)channel.onmessage=e=>{if(e.data===draftKey(actorId,eventId))void load();};return()=>channel?.close();});
 $effect(()=>{if(refresh)void load();});
 async function discard(){if(!saved||!confirm('Discard the sorting draft saved on this device?'))return;try{await writeDraft(saved.key,saved.revision,null);await load();message='';}catch(e){message=e instanceof Error?e.message:'Could not discard draft';}}
 async function undo(){if(!action||busy||!confirm(`Undo collection assignments from the last sorting save (${action.photos} photos)? New collection names will remain available.`))return;busy=true;try{await api(`/admin/api/events/${eventId}/organize/undo`,{method:'POST',json:{id:action.id}});await load();onundo();message='Sorting assignments undone.';}catch(e){message=e instanceof Error?e.message:'Could not undo';}finally{busy=false;}}
</script>
{#if saved?.draft || action || message}
 <section aria-label="Sorting recovery" class="my-3 rounded-xl border border-stone-200 bg-white p-3 text-sm">
 {#if saved?.draft}<div class="flex flex-wrap items-center gap-3"><span class="mr-auto">Sorting draft · {saved.draft.photoIds.length} photos · saved on this device</span><button class="button-secondary" onclick={()=>saved&&onresume(saved)}>Resume sorting draft</button><button class="underline" onclick={discard}>Discard draft</button></div>{/if}
 {#if action}<button class="mt-2 text-xs underline" disabled={busy} onclick={undo}>Undo last sorting save ({action.photos} photos)</button>{/if}
 {#if message}<p role="status" class="mt-2 text-xs">{message}</p>{/if}
 </section>
{/if}
