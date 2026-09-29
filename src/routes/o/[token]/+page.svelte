<script lang="ts">
  import { groupPrints } from '$shared/prints';
  import { formatCents } from '$shared/money';
  import { STATUS_LABELS, type OrderStatus } from '$shared/orders';
  import OrderPayment from '$lib/components/OrderPayment.svelte';
  import { photoShareUrl, sharePhoto } from '$lib/client/photos';
  import { toast } from '$lib/client/toast.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  let { data, form } = $props();
  let refreshing=$state(false), refreshError=$state('');
  const stages=['received','preparing','printed','delivered'];
  const currentStage=$derived(stages.indexOf(data.progress));
  async function refreshStatus(){refreshing=true;refreshError='';try{await invalidateAll();}catch{refreshError='Could not refresh. Your saved order is unchanged; try again.';}finally{refreshing=false;}}
  let orderLink = $state('');
  let showLink = $state(false);
  onMount(() => { orderLink = window.location.origin + window.location.pathname; });
  const due = $derived(Math.max(0, data.order.totalCents - data.order.paidCents));
  const cancelled = $derived(data.order.status === 'cancelled');
  async function copyLink() { try { await navigator.clipboard.writeText(orderLink); toast('Order link copied. Keep it for your records.', 'success'); } catch { showLink = true; } }
  function groupsFor(item: (typeof data.items)[number]) { return groupPrints(item.sheets.flatMap(s => s.cells.map(c => ({ sheetIdx: s.sheetIndex, cellIndex: c.cellIndex, sizeCode: c.printSizeCode, sizeChoice: c.sizeChoice, photoId: c.photoId })))); }
</script>
<svelte:head><title>Your prints · Order {data.order.number}</title></svelte:head>
<Toasts />
<div class="parent-shell">
<main class="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:pt-12">
  <p class="eyebrow">{data.event.name} / print order</p>
  <h1 class="display-title mt-4 text-4xl sm:text-5xl">{cancelled?'Order canceled.':data.justPlaced && data.progress==='received'?'Order received.':'Your print order.'}</h1>
  {#if data.justPlaced && !cancelled && data.progress==='received'}<p class="mt-3 text-stone-600">Thank you, {data.order.customerName.split(' ')[0]}. Your selections are saved.</p>{/if}
  <div class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><p class="eyebrow">Order number</p><p class="mt-1 text-xl font-bold">{data.order.number}</p></div><span class="rounded-full bg-stone-100 px-3 py-2 text-sm font-medium">{STATUS_LABELS[data.order.status as OrderStatus] ?? data.order.status}</span></div>
    <div class="mt-4 flex flex-wrap gap-2 print:hidden"><button type="button" class="button-primary" onclick={copyLink}>Copy order link</button><button type="button" class="button-secondary" onclick={() => window.print()}>Save / print confirmation</button></div>
    {#if showLink}<label class="mt-3 block text-sm">Copy this order link<input readonly value={orderLink} onclick={(e) => e.currentTarget.select()} class="mt-1 w-full rounded-lg border border-stone-300 p-3" /></label>{/if}
    <p class="mt-3 text-xs text-stone-500">Keep this link for your order status and contact details.</p>
    {#if data.receiptStatus === 'sent'}<p class="mt-3 text-sm text-stone-600">An email receipt was sent to {data.order.email}. Check your spam folder if it has not arrived.</p>
    {:else if data.receiptStatus === 'queued'}<p class="mt-3 text-sm text-stone-600">Your email receipt is queued. You can save this confirmation now.</p>
    {:else if data.receiptStatus === 'failed'}<p class="mt-3 text-sm text-stone-600">Your order is safe, but the email receipt could not be sent. Save this confirmation link.</p>
    {:else}<p class="mt-3 text-sm text-stone-600">This page is your confirmation. Save it so you can find your order again.</p>{/if}
  </div>
  {#if !cancelled}<section aria-label="Order progress" class="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
    <div class="flex items-center justify-between gap-3"><h2 class="font-semibold">Your order’s progress</h2><button type="button" class="button-quiet text-sm print:hidden" disabled={refreshing} onclick={refreshStatus}>{refreshing?'Refreshing…':'Refresh status'}</button></div>
    <ol class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{#each stages as stage,index}<li aria-current={index===currentStage?'step':undefined} class={`rounded-lg border p-3 text-sm ${index<=currentStage?'border-stone-800 bg-stone-900 text-white':'border-stone-200 text-stone-500'}`}><span class="block text-xs">{index<currentStage?'✓':index+1}</span><strong class="mt-1 block capitalize">{stage}</strong></li>{/each}</ol>
    <p class="mt-3 text-sm text-stone-600">{data.progress==='received'?'Your selections are saved for the photographer.':data.progress==='preparing'?'Your photos are being reviewed and prepared for printing.':data.progress==='printed'?'Your prints are finished. Check the pickup or delivery details below.':'The photographer has marked this order delivered.'}</p>
    <p class="mt-2 text-xs text-stone-500">Payment is tracked separately below.</p>
    {#if refreshError}<p role="alert" class="mt-2 text-sm text-red-800">{refreshError}</p>{/if}
    {#if data.pickupInstructions}<div class="mt-4 border-t border-stone-200 pt-4"><h3 class="font-semibold">Pickup / delivery</h3><p class="mt-2 whitespace-pre-wrap text-sm">{data.pickupInstructions}</p></div>{:else if data.progress==='printed'}<p class="mt-3 text-sm">Contact the photographer to arrange pickup or delivery.</p>{/if}
    {#if data.emailUpdatesAvailable&&data.order.email}<form method="post" action="?/updates" use:enhance class="mt-4 border-t border-stone-200 pt-4 print:hidden"><label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="updates" checked={data.order.emailUpdates} />Email me when prints are printed or delivered</label><p class="mb-3 text-xs text-stone-500">Updates go to {data.order.email}.</p><button class="button-secondary">Save email preference</button>{#if form?.updatesSaved}<p role="status" class="mt-2 text-sm text-emerald-800">Email preference saved.</p>{/if}{#if form?.updatesError}<p role="alert" class="mt-2 text-sm text-red-800">{form.updatesError}</p>{/if}</form>{/if}
  </section>{/if}
  {#if cancelled}<div class="notice mt-5 text-sm"><strong>This order is canceled.</strong> Please do not send payment for it.{#if data.order.paidCents > 0} Contact the photographer about any payment already recorded.{/if}</div>
  {:else if due > 0}
    <OrderPayment {due} paid={data.order.paidCents} currency={data.order.currency} orderNumber={data.order.number} venmo={data.venmo} instructions={data.paymentInstructions} />
  {:else}<p class="notice mt-5 text-sm">✓ Your order is recorded as paid. Thank you!</p>{/if}
  <section class="mt-7 space-y-4" aria-label="Your selected prints">
    {#each data.items as item (item.id)}
      <div class="photo-card p-4 sm:p-5"><div class="flex items-baseline justify-between gap-3"><h2 class="font-semibold">{item.quantity}× {item.productName}</h2><span class="font-medium">{formatCents(item.totalCents, data.order.currency)}</span></div>
        <div class="mt-4 space-y-4">{#each groupsFor(item) as g (g.key)}<div><p class="mb-2 text-sm font-medium">{g.label} · {g.count * item.quantity} print{g.count * item.quantity === 1 ? '' : 's'}</p><div class="flex flex-wrap gap-2">{#each g.prints as pr (pr.sheetIdx + ':' + pr.cellIndex)}{#if pr.photoId}<div class="w-24 overflow-hidden rounded-lg border border-stone-200 bg-stone-50"><a href={photoShareUrl({ id: pr.photoId }, data.event.slug)} aria-label={`Open selected ${g.label} preview`}><img src={data.photoUrls[pr.photoId]} alt={`Selected ${g.label} preview`} class="h-28 w-full object-contain" loading="lazy" /></a><p class="py-1 text-center text-xs">{item.quantity} cop{item.quantity === 1 ? 'y' : 'ies'}</p><button type="button" class="min-h-11 w-full border-t border-stone-200 text-xs underline print:hidden" onclick={() => sharePhoto({ id: pr.photoId! }, data.event.slug)}>Share photo ↗</button></div>{/if}{/each}</div></div>{/each}</div>
      </div>
    {/each}
  </section>
  <div class="mt-5 flex items-baseline justify-between border-t border-stone-300 pt-4 text-lg"><span>Total</span><span class="font-semibold">{formatCents(data.order.totalCents, data.order.currency)}</span></div>
  <section class="mt-8 text-sm text-stone-600"><h2 class="font-semibold text-stone-900">Contact on this order</h2><p class="mt-2">{data.order.customerName}{data.order.phone ? ` · ${data.order.phone}` : ''}{data.order.email ? ` · ${data.order.email}` : ''}</p>{#if data.order.subjectName}<p>For: {data.order.subjectName}</p>{/if}{#if data.order.notes}<p class="mt-2 whitespace-pre-line">{data.order.notes}</p>{/if}</section>
  {#if Object.keys(data.order.photoRequests??{}).length}<section aria-label="Your photo requests" class="mt-6 rounded-xl border border-stone-200 bg-white p-4"><h2 class="font-semibold">Your photo requests</h2>{#each Object.entries(data.order.photoRequests) as [id,note]}<div class="mt-3 flex gap-3">{#if data.photoUrls[Number(id)]}<img src={data.photoUrls[Number(id)]} alt={`Photo ${id}`} class="h-24 w-20 rounded-lg object-contain" />{/if}<p class="whitespace-pre-wrap text-sm"><strong class="block">Photo {id}</strong>{note}</p></div>{/each}</section>{/if}
  {#if data.parentMessage}<section class="notice mt-6 whitespace-pre-line text-sm"><h2 class="eyebrow mb-2">A note from the studio</h2>{data.parentMessage}</section>{/if}
  <footer class="mt-10 border-t border-stone-200 pt-5 text-xs text-stone-500"><p>{data.studio.name}{data.studio.photographer ? ` · ${data.studio.photographer}` : ''}{data.studio.contact ? ` · ${data.studio.contact}` : ''}</p><p class="mt-3"><a href={`/g/${data.event.slug}`} class="button-secondary print:hidden">Back to photos</a></p></footer>
</main>
</div>
