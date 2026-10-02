<script lang="ts">
 import { enhance } from '$app/forms';
 import { beforeNavigate } from '$app/navigation';
 let {data,form}=$props();let selected=$state<number[]>([]),notes=$state<Record<string,string>>({}),message=$state(''),dirty=$state(false),saving=$state(false);
 $effect(()=>{selected=[...data.round.selected];notes={...data.round.notes};message=data.round.message;dirty=false;});
 beforeNavigate(({cancel})=>{if(dirty&&!confirm('Leave without saving your selection draft?'))cancel();});
</script>
<svelte:window onbeforeunload={e=>{if(dirty){e.preventDefault();e.returnValue='';}}} />
<main class="album-home"><a class="button-quiet" href={`/g/${data.event.slug}/proofs`}>← Selection rounds</a><h1 class="mt-5 text-3xl font-semibold">{data.round.title}</h1><p class="mt-2">Status: <strong>{data.round.status}</strong></p><p class="mt-2 text-sm text-stone-600">Choose images and submit them to your photographer. This does not place an order or change your device favorites. Anyone with this invitation can edit its open rounds.</p>
{#if data.round.reviewNote}<aside class="notice my-4"><strong>Photographer feedback</strong><p class="whitespace-pre-line">{data.round.reviewNote}</p></aside>{/if}
{#if form?.error}<p role="alert" class="notice my-4">{form.error}</p>{/if}{#if form?.ok}<p role="status" class="notice my-4">{form.ok}</p>{/if}
<form method="post" oninput={()=>dirty=true} use:enhance={()=>{saving=true;return async({result,update})=>{await update({reset:false});saving=false;if(result.type==='success')dirty=false;};}}>
<input type="hidden" name="version" value={data.round.version} />
<fieldset disabled={data.round.status!=='open'||saving}><legend class="my-4 font-semibold">{selected.length} selected</legend>
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{#each data.photos as photo}<article class="min-w-0 rounded-xl border bg-white p-3"><label class="block"><img src={photo.urls.preview} alt="" loading="lazy" class="aspect-[4/3] w-full rounded-lg object-contain" /><span class="mt-3 flex items-center gap-2"><input type="checkbox" name="photoIds" value={photo.id} bind:group={selected} />Photo {photo.id}</span></label>{#if selected.includes(photo.id)}<label class="mt-3 block text-sm">Note for Photo {photo.id}<textarea name={`note_${photo.id}`} maxlength="500" bind:value={notes[String(photo.id)]} class="mt-1 w-full rounded-lg border p-2"></textarea></label>{/if}</article>{/each}</div>
<label class="mt-5 block">Message to your photographer<textarea name="message" maxlength="2000" bind:value={message} class="mt-2 block w-full rounded-lg border p-3"></textarea></label>
{#if data.round.status==='open'}<div class="mt-5 flex flex-wrap gap-3"><button class="button-secondary" name="intent" value="draft">Save draft</button><button class="button-primary" name="intent" value="submit">Submit selection</button>{#if dirty}<span class="self-center text-sm">Unsaved changes</span>{/if}</div>{/if}</fieldset></form>
{#if data.round.status!=='open'}<p class="notice mt-5">This round is locked. Your photographer can reopen it for revisions.</p>{/if}</main>
