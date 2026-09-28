<script lang="ts">
  import { enhance } from '$app/forms';
  import Fulfillment from '$lib/components/Fulfillment.svelte';
  import SheetDiagram from '$lib/components/SheetDiagram.svelte';
  import { toast } from '$lib/client/toast.svelte';
  import { thumbUrl } from '$lib/client/api';
  import { formatCents } from '$shared/money';
  import { allowedTransitions, PAYMENT_METHODS, STATUS_LABELS, type OrderStatus } from '$shared/orders';
  import { cropLossExceeds, fitPhotoToCell } from '$shared/geometry';
  let { data, form } = $props();
  $effect(() => { if (form?.ok) toast(String(form.ok), 'success'); if (form?.error) toast(String(form.error), 'error'); });
  const o = $derived(data.d.order);
  const due = $derived(Math.max(0, o.totalCents - data.d.paidCents));
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); toast('Copied', 'success'); } catch { toast('Copy failed', 'error'); } }
  function sheetFor(s: (typeof data.d.items)[number]['sheets'][number]) {
    return { code: s.templateCode, label: s.label, paperWidthIn: s.paperWidthIn, paperHeightIn: s.paperHeightIn, cells: s.cells.map((c) => ({ cellIndex: c.cellIndex, printSizeCode: c.printSizeCode, label: c.label, xIn: c.xIn, yIn: c.yIn, wIn: c.wIn, hIn: c.hIn, rotation: (c.rotation === 90 ? 90 : 0) as 0 | 90 })) };
  }
</script>

<a href="/admin/orders" class="text-sm text-stone-500 hover:underline">← Orders</a>
<div class="mt-1 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{o.orderNumber}</h1>
  <span class="rounded bg-stone-200 px-2 py-0.5 text-xs">{STATUS_LABELS[o.status as OrderStatus]}</span>
  {#if data.d.paidCents >= o.totalCents}<span class="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Paid</span>{:else}<span class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{formatCents(due, o.currency)} due</span>{/if}
  <span class="text-sm text-stone-500">{data.d.event.name} · {new Date(o.createdAt).toLocaleString()}</span>
  {#if data.production.ready && (data.work.reviewComplete || ['printed','delivered'].includes(o.status))}<a href={`/admin/api/orders/${o.id}/print-files`} data-sveltekit-reload class="ml-auto rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">Download print files</a>{:else}<span class="ml-auto rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">Print preparation needed</span>{/if}
  <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm" onclick={() => copy(data.statusUrl)}>Copy parent link</button>
</div>

<Fulfillment work={data.work} orderId={o.id} status={o.status} actionKey={data.workflowKey} filesReady={data.production.ready} />
{#if data.production.ready && data.work.editable}<a class="mt-3 inline-block text-sm underline" href={`/admin/api/orders/${o.id}/print-files?purpose=review`} data-sveltekit-reload>Download sources for touch-ups</a>{/if}

{#if !data.production.ready}
  <section class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Production holds">
    <h2 class="font-semibold">A quick master-file check before printing</h2>
    <p class="mt-1 text-sm">Only full-resolution print masters are exported. Upload missing masters, then review any changes below.</p>
    <ul class="my-3 space-y-2 text-sm">
      {#each data.production.conflicts as conflict (conflict.cellId)}
        <li class="flex items-center gap-3">
          {#if conflict.photoId}<img src={thumbUrl(conflict.photoId, null)} alt="" class="h-16 w-16 rounded-lg object-contain" />{/if}
          <div><strong>{conflict.photoStem}</strong> · {conflict.reason.replaceAll('_', ' ')}
          {#if conflict.currentSha256}<p class="text-xs text-stone-600">Current master: {conflict.currentSha256.slice(0, 12)} · previously approved: {conflict.orderedSha256?.slice(0, 12) ?? 'none'}</p>{/if}</div>
        </li>
      {/each}
    </ul>
    {#if data.production.conflicts.some((c) => c.reason === 'changed_print' || c.reason === 'unapproved_print') && ['new', 'in_progress'].includes(o.status)}
      <form method="post" action="?/approveMasters" use:enhance class="flex flex-wrap items-end gap-3">
        <input type="hidden" name="reviewed" value={JSON.stringify(data.production.conflicts.filter((c) => c.reason === 'changed_print' || c.reason === 'unapproved_print').map((c) => ({ cellId: c.cellId, sha256: c.currentSha256 })))} />
        <label class="flex-1 text-sm">Reason for using these masters<input name="reason" required maxlength="1000" placeholder="Final edited exports, reviewed in Lightroom" class="mt-1 block w-full rounded-lg border border-amber-300 bg-white p-2" /></label>
        <button class="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white">Approve reviewed masters</button>
      </form>
    {/if}
  </section>
{/if}
<div class="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
  <div class="space-y-4">
    <p class="text-xs text-stone-500">Layout previews allow a 90° rotation to fit. Final rotation and framing are set in Lightroom.</p>
    {#each data.d.items as item (item.id)}
      <section class="rounded-xl border border-stone-200 bg-white p-4">
        <div class="flex items-baseline justify-between"><h2 class="font-semibold">{item.quantity}× {item.productName}</h2><span>{formatCents(item.totalCents, o.currency)}</span></div>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {#each item.sheets as s (s.id)}
            {@const content = Object.fromEntries(s.cells.map((c) => [c.cellIndex, { thumb: c.photoId ? thumbUrl(c.photoId, c.thumbHash) : null, label: c.photoStem, photoWidth: c.photoWidth, photoHeight: c.photoHeight, missing: !c.photoId || !c.printSha256, warn: cropLossExceeds(c.photoWidth ?? 0, c.photoHeight ?? 0, c.wIn, c.hIn) }]))}
            <div>
              <SheetDiagram sheet={sheetFor(s)} {content} showLabels={false} />
              <p class="mt-1 text-[11px] text-stone-500">Sheet {s.sheetIndex + 1}: {s.label}</p>
              <ul class="mt-1 text-[11px] text-stone-700">
                {#each s.cells as c (c.id)}
                  {@const fit = fitPhotoToCell(c.photoWidth ?? 0, c.photoHeight ?? 0, c.wIn, c.hIn)}
                  <li>{c.sizeChoice ?? c.printSizeCode}: <span class="font-medium">{c.photoStem}</span>
                    {#if c.photoId && fit?.rotation === 90}<span class="text-stone-500"> (rotate 90°)</span>{/if}
                    {#if c.photoId && cropLossExceeds(c.photoWidth ?? 0, c.photoHeight ?? 0, c.wIn, c.hIn)}<span class="text-amber-700"> (heavy crop)</span>{/if}
                    {#if !c.photoId}<span class="text-red-700"> (photo deleted)</span>{:else if !c.currentPrintSha}<span class="text-amber-700"> (print master missing)</span>{:else if !c.printSha256}<span class="text-amber-700"> (print master needs approval)</span>{:else if c.currentPrintSha && c.currentPrintSha !== c.printSha256}<span class="text-amber-700"> (print file changed since order)</span>{/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </section>
    {/each}
    <div class="flex justify-between border-t border-stone-300 pt-2 text-lg"><span>Total</span><span class="font-semibold">{formatCents(o.totalCents, o.currency)}</span></div>

    <section class="rounded-xl border border-stone-200 bg-white p-4">
      <div class="flex items-center justify-between"><h2 class="font-semibold">Pick list</h2><button type="button" class="text-sm underline" onclick={() => copy(data.pick.join('\n'))}>Copy</button></div>
      <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-stone-50 p-3 text-xs">{data.pick.join('\n')}</pre>
    </section>

    <section class="rounded-xl border border-stone-200 bg-white p-4">
      <h2 class="font-semibold">Order history</h2>
      <ul class="mt-2 space-y-1 text-sm">
        {#each data.d.events as ev (ev.id)}
          <li class="flex gap-2"><span class="w-40 shrink-0 text-xs text-stone-500">{new Date(ev.createdAt).toLocaleString()}</span><span>{({photo_preparation:'Photo preparation',special_requests:'Special requests saved',requests_addressed:'Requests addressed',print_masters_approved:'Print masters approved'} as Record<string,string>)[ev.type] ?? ev.type}{ev.data && 'photo' in ev.data ? ` · ${ev.data.photo}` : ''}{ev.data && 'to' in ev.data ? `: ${ev.data.from} → ${ev.data.to}` : ''}{ev.data && 'amountCents' in ev.data ? `: ${formatCents(Number(ev.data.amountCents), o.currency)} ${ev.data.method ?? ''}` : ''} <span class="text-xs text-stone-400">by {ev.actor}</span></span></li>
        {/each}
        {#each data.d.deliveries as d (d.id)}
          <li class="flex gap-2 text-xs"><span class="w-40 shrink-0 text-stone-500">{new Date(d.createdAt).toLocaleString()}</span><span class={d.status === 'sent' ? 'text-emerald-700' : d.status === 'dead' ? 'text-red-700' : 'text-stone-600'}>notification {d.eventType} via {d.recipient?.split(':')[0]}: {d.status}{d.lastError ? ` (${d.lastError})` : ''}</span></li>
        {/each}
      </ul>
    </section>
  </div>

  <aside class="space-y-4">
    <section class="rounded-xl border border-stone-200 bg-white p-4">
      <h2 class="font-semibold">Payments</h2>
      <ul class="mt-2 text-sm">
        {#each data.d.payments as p (p.id)}
          <li class="flex items-center gap-2 py-1"><span>{formatCents(p.amountCents, o.currency)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span><span class="ml-auto text-xs text-stone-500">{new Date(p.paidAt).toLocaleDateString()}</span>
            <form method="post" action="?/unpay" use:enhance><input type="hidden" name="paymentId" value={p.id} /><button class="text-xs text-red-700 underline">remove</button></form></li>
        {:else}<li class="text-stone-500">Nothing recorded yet.</li>{/each}
      </ul>
      {#if due > 0 && o.status !== 'cancelled'}
        <form method="post" action="?/pay" use:enhance class="mt-3 grid grid-cols-2 gap-2 text-sm">
          <input type="hidden" name="idempotencyKey" value={data.paymentKey} />
          <label class="text-xs">Amount $<input name="amount" value={(due / 100).toFixed(2)} inputmode="decimal" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" /></label>
          <label class="text-xs">Method<select name="method" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1">{#each PAYMENT_METHODS as m (m)}<option value={m}>{m}</option>{/each}</select></label>
          <label class="col-span-2 text-xs">Reference<input name="reference" placeholder="Venmo note, check #…" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" /></label>
          <button class="col-span-2 rounded-lg bg-emerald-700 px-3 py-2 text-white">Record payment</button>
        </form>
      {/if}
    </section>

    <form method="post" action="?/contact" use:enhance class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
      <h2 class="font-semibold">Contact</h2>
      <label class="mt-2 block text-xs">Name<input name="customerName" value={o.customerName} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" /></label>
      <label class="mt-2 block text-xs">Phone<input name="phone" value={o.phone ?? ''} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" />{#if o.phone}<a href={`tel:${o.phone}`} class="text-xs underline">call</a>{/if}</label>
      <label class="mt-2 block text-xs">Email<input name="email" value={o.email ?? ''} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" /></label>
      <label class="mt-2 block text-xs">For ({data.d.event.subjectLabel})<input name="subjectName" value={o.subjectName ?? ''} class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1" /></label>
      {#if o.notes}<p class="mt-2 text-xs italic text-stone-600">Parent's note: "{o.notes}"</p>{/if}
      <button class="mt-2 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">Save contact</button>
    </form>

    <form method="post" action="?/notes" use:enhance class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
      <h2 class="font-semibold">My notes</h2>
      <textarea name="adminNotes" rows="3" class="mt-2 w-full rounded border border-stone-300 px-2 py-1">{o.adminNotes ?? ''}</textarea>
      <button class="mt-2 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">Save notes</button>
    </form>
  </aside>
</div>
