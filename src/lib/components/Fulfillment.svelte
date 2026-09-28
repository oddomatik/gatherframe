<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';
  import PreviewFrame from './PreviewFrame.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { toast } from '$lib/client/toast.svelte';
  import { thumbUrl } from '$lib/client/api';
  import { WORK_LABELS, PHOTO_WORK_STATES, FULFILLMENT_LABELS } from '$shared/fulfillment';
  import { allowedTransitions, STATUS_LABELS, type OrderStatus } from '$shared/orders';
  import type { fulfillment } from '$server/fulfillment';
  let { work, orderId, status, actionKey, filesReady }: {work: ReturnType<typeof fulfillment>; orderId:number; status:string; actionKey:string; filesReady:boolean} = $props();
  let dirty = $state<string[]>([]), busy = $state(false);
  function edited(key:string) { if (!dirty.includes(key)) dirty = [...dirty,key]; }
  function guardUnload(e:BeforeUnloadEvent) { if(dirty.length) { e.preventDefault(); e.returnValue=''; } }
  beforeNavigate(({cancel})=>{if(dirty.length && !window.confirm('Leave without saving your preparation notes?')) cancel();});
  let previewKey = $state<string|null>(null);
  const reviewPhotos = $derived(work.photos.filter(p=>p.photoId));
  const previewIndex = $derived(reviewPhotos.findIndex(p=>p.key===previewKey));
  const preview = $derived(reviewPhotos[previewIndex]);
  const previewItems = $derived(reviewPhotos.map(p=>({id:p.key,label:p.stem,thumb:thumbUrl(p.photoId!,p.thumbHash),preview:thumbUrl(p.photoId!,p.thumbHash,'web')})));
  function movePreview(delta:number) { const p=reviewPhotos[previewIndex+delta]; if(p) previewKey=p.key; }
  const submit = (key:string): SubmitFunction => ({cancel}) => {
    if(busy) {cancel();return;}
    busy=true;
    return async ({result,update}: {result:import('@sveltejs/kit').ActionResult;update:(options?:{reset?:boolean;invalidateAll?:boolean})=>Promise<void>}) => {
      try {
        if(result.type==='error') { toast('Could not confirm the save. Your notes are still here; retry when connected.','error'); return; }
        if(result.type==='success') dirty=dirty.filter(k=>k!==key);
        await update({reset:false,invalidateAll:result.type==='success'});
      } finally {busy=false;}
    };
  };
</script>
<svelte:window onbeforeunload={guardUnload} />
<section id="preparation" class="fulfillment mt-5 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6" aria-label="Print preparation">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div><p class="eyebrow">Print preparation</p><h2 class="mt-1 text-2xl font-semibold">{FULFILLMENT_LABELS[work.stage]}</h2>
      <p class="mt-1 text-sm text-stone-600">{work.reviewed} of {work.photos.length} photos reviewed{work.hasRequests ? ` · requests ${work.requestsAddressed ? 'addressed' : 'need attention'}` : ''}</p></div>
    <nav aria-label="Fulfillment progress" class="flex flex-wrap gap-1 text-xs">
      {#each ['review','touchups','ready','printed','delivered'] as stage}
        <span aria-current={work.stage===stage?'step':undefined} class={`rounded-full px-2.5 py-1.5 ${work.stage===stage?'bg-stone-900 text-white':'bg-stone-100 text-stone-600'}`}>{FULFILLMENT_LABELS[stage as keyof typeof FULFILLMENT_LABELS]}</span>
      {/each}
    </nav>
  </div>
  {#if dirty.length}<p role="status" class="mt-3 text-sm text-amber-900">Unsaved preparation notes</p>{/if}
  {#if work.editable}
    <div class="mt-4 rounded-xl bg-stone-50 p-4" aria-label="Special requests">
      <h3 class="font-semibold">Special requests</h3>
      {#if work.parentNotes}<blockquote class="mt-2 whitespace-pre-wrap border-l-2 border-stone-300 pl-3 text-sm"><span class="mb-1 block text-xs text-stone-500">From the order</span>{work.parentNotes}</blockquote>{/if}
      <form method="post" action="?/work" use:enhance={submit('requests')} class="mt-3">
        <input type="hidden" name="kind" value="requests" /><input type="hidden" name="revision" value={work.revision} /><input type="hidden" name="actionId" value={`${actionKey}:requests`} />
        <label class="block text-sm">Requests from messages or conversations<textarea name="notes" rows="2" maxlength="4000" oninput={()=>edited('requests')} class="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2">{work.extraRequests}</textarea></label>
        <button class="button-secondary mt-2" disabled={busy}>Save requests</button>
      </form>
      {#if work.hasRequests}
        {#if work.requestsAddressed}<p class="mt-3 text-sm text-emerald-800">✓ Requests addressed</p>
        {:else}<form method="post" action="?/work" use:enhance={submit('resolve')} class="mt-3">
          <input type="hidden" name="kind" value="resolve_requests" /><input type="hidden" name="revision" value={work.revision} /><input type="hidden" name="actionId" value={`${actionKey}:resolve`} />
          <button class="button-secondary" disabled={busy||dirty.includes('requests')}>Mark requests addressed</button>
        </form>{/if}
      {/if}
    </div>
  {:else if work.hasRequests}
    <div class="mt-4 rounded-xl bg-stone-50 p-4"><h3 class="font-semibold">Special requests</h3><p class="mt-2 whitespace-pre-wrap text-sm">{work.parentNotes}</p><p class="mt-2 whitespace-pre-wrap text-sm">{work.extraRequests}</p></div>
  {/if}
  <div class="mt-4 grid gap-3 xl:grid-cols-2">
    {#each work.photos as p (p.key)}
      <article class="rounded-xl border border-stone-200 p-3" aria-label={`Prepare ${p.stem}`}>
        <div class="flex gap-3">
          {#if p.photoId}<button type="button" aria-label={`Preview ${p.stem}`} onclick={()=>previewKey=p.key} class="shrink-0 rounded-lg focus-visible:outline-2"><img src={thumbUrl(p.photoId,p.thumbHash)} alt="" class="h-28 w-24 rounded-lg bg-stone-50 object-contain" loading="lazy" /></button>{/if}
          <div class="min-w-0"><h3 class="break-words font-medium">{p.stem}</h3><p class="mt-1 text-xs text-stone-600">{p.prints.map(p=>`${p.count} × ${p.size}`).join(' · ')}</p>
            <p class={`mt-2 text-sm ${p.state==='ready'?'text-emerald-800':p.state==='needs_touchup'?'text-amber-900':'text-stone-600'}`}>{WORK_LABELS[p.state]}</p>
            {#if p.stale}<p class="mt-1 text-xs text-amber-900">Master changed since review. Review the corrected export again.</p>{/if}
            {#if !p.masterMatches}<p class="mt-1 text-xs text-amber-900">Master approval needed below.</p>{/if}
          </div>
        </div>
        {#if p.parentNote}<blockquote class="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm"><strong class="block">Customer request</strong>{p.parentNote}</blockquote>{/if}
        {#if work.editable}<form method="post" action="?/work" use:enhance={submit(p.key)} class="mt-3">
          <input type="hidden" name="kind" value="photo" /><input type="hidden" name="photoKey" value={p.key} /><input type="hidden" name="revision" value={work.revision} /><input type="hidden" name="actionId" value={`${actionKey}:${p.key}`} />
          <label class="block text-xs">Touch-up / production note<textarea name="note" rows="2" maxlength="2000" oninput={()=>edited(p.key)} class="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm">{p.note}</textarea></label>
          <div class="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"><label class="flex-1 text-xs">Photo status<select name="state" value={p.state} onchange={()=>edited(p.key)} class="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">{#each PHOTO_WORK_STATES as state}<option value={state} disabled={state==='ready'&&!p.masterMatches}>{WORK_LABELS[state]}</option>{/each}</select></label><button class="button-secondary" disabled={busy}>Save photo review</button></div>
        </form>{:else if p.note}<p class="mt-3 whitespace-pre-wrap text-sm">{p.note}</p>{/if}
      </article>
    {:else}<p class="text-sm text-stone-600">No photo selections in this order.</p>{/each}
  </div>
  <div class="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
    {#each allowedTransitions(status as OrderStatus) as to}
      <form method="post" action="?/status" use:enhance={submit('status')}>
        <input type="hidden" name="to" value={to} /><input type="hidden" name="revision" value={work.revision} /><input type="hidden" name="actionId" value={`${actionKey}:status:${to}`} />
        <button class={to==='cancelled'?'button-secondary text-red-800':to==='printed'||to==='delivered'?'button-primary':'button-secondary'} disabled={busy||dirty.length>0||(to==='printed'&&(!filesReady||(!work.reviewComplete&&status!=='delivered')))}>{to==='cancelled'?'Cancel order':`Mark ${STATUS_LABELS[to].toLowerCase()}`}</button>
      </form>
    {/each}
    {#if work.editable && !work.reviewComplete}<p class="text-xs text-stone-500">Review photos and address requests before marking printed.</p>{/if}
    {#if !work.editable && status!=='cancelled'}<p class="text-xs text-stone-500">Reopen for preparation changes. Payment is tracked separately.</p>{/if}
  </div>
</section>

<BottomSheet open={!!preview} title="Review current edit" onclose={()=>previewKey=null} wide>
  {#if preview}
    <PreviewFrame index={previewIndex} total={reviewPhotos.length} onprevious={()=>movePreview(-1)} onnext={()=>movePreview(1)} items={previewItems} onselect={key=>previewKey=String(key)}>
      <img src={thumbUrl(preview.photoId!,preview.thumbHash,'web')} alt={preview.stem} class="mx-auto max-h-[60vh] w-full object-contain" />
    </PreviewFrame>
    <p class="mt-3 text-center text-sm">{preview.stem} · Current gallery edit</p>
    {#if !preview.masterMatches}<p class="mt-2 text-center text-sm text-amber-900">This edit still needs print-master approval.</p>{/if}
  {/if}
</BottomSheet>
