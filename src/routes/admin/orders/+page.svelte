<script lang="ts">
  import { FULFILLMENT_LABELS } from '$shared/fulfillment';
  import { formatCents } from '$shared/money';
  import { ORDER_STATUSES, STATUS_LABELS } from '$shared/orders';
  let { data } = $props();
  let selected = $state<number[]>([]);
  function pageUrl(page: number) { const q = new URLSearchParams(); if(data.filter.work) q.set('work',data.filter.work); if(data.filter.status) q.set('status',data.filter.status); if(data.filter.eventId) q.set('event',String(data.filter.eventId)); if(data.filter.unpaid) q.set('unpaid','1'); if(data.filter.q) q.set('q',data.filter.q); q.set('page',String(page)); return `/admin/orders?${q}`; }
  const badge: Record<string, string> = { new: 'bg-amber-100 text-amber-900', in_progress: 'bg-sky-100 text-sky-900', printed: 'bg-violet-100 text-violet-900', delivered: 'bg-emerald-100 text-emerald-900', cancelled: 'bg-stone-200 text-stone-600' };
</script>


<h1 class="display-title mt-1 text-4xl">The print table</h1>
<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
  <div class="photo-card p-4"><p class="text-xs text-stone-500">Matching orders</p><strong class="text-2xl">{data.summary.count}</strong></div>
  <div class="photo-card p-4"><p class="text-xs text-stone-500">Order value · active</p><strong class="text-xl">{formatCents(data.summary.totalCents, data.currency)}</strong></div>
  <div class="photo-card p-4"><p class="text-xs text-stone-500">Payments recorded</p><strong class="text-xl">{formatCents(data.summary.paidCents, data.currency)}</strong></div>
  <div class="photo-card p-4"><p class="text-xs text-stone-500">Still to collect · active</p><strong class="text-xl">{formatCents(data.summary.dueCents, data.currency)}</strong></div>
</div>
{#if data.summary.methods.length}<p class="mt-3 text-xs text-stone-600">Recorded: {data.summary.methods.map(m => `${m.method} ${formatCents(m.cents, data.currency)}`).join(' · ')} · payment entries are recorded manually.</p>{/if}
<form method="get" class="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
  <label>Status<select name="status" class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5"><option value="">All</option>{#each ORDER_STATUSES as s (s)}<option value={s} selected={data.filter.status === s}>{STATUS_LABELS[s]}</option>{/each}</select></label>
  <label>Preparation<select name="work" class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5"><option value="">All</option>{#each ['review','touchups','ready'] as stage}<option value={stage} selected={data.filter.work===stage}>{FULFILLMENT_LABELS[stage as keyof typeof FULFILLMENT_LABELS]}</option>{/each}</select></label>
  <label>Event<select name="event" class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5"><option value="">All</option>{#each data.events as ev (ev.id)}<option value={ev.id} selected={data.filter.eventId === ev.id}>{ev.name}</option>{/each}</select></label>
  <label class="flex items-center gap-1 pb-2"><input type="checkbox" name="unpaid" value="1" checked={data.filter.unpaid} /> Unpaid only</label>
  <label>Search<input name="q" value={data.filter.q ?? ''} placeholder="name, number, reference, phone" class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5" /></label>
  <button class="rounded-lg bg-stone-900 px-3 py-2 text-white">Filter</button>
  <a href="/admin/orders" class="px-2 py-2 underline">Reset</a>
</form>

<div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm"><span>Showing {data.orders.length} of {data.summary.count}</span>{#if selected.length}<a class="button-secondary" href={`/admin/orders/print?ids=${selected.join(',')}`} target="_blank" rel="noopener">Open {selected.length} job tickets ↗</a>{/if}</div>
<div class="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
  <table class="w-full text-sm">
    <thead><tr class="text-left text-xs text-stone-500"><th class="px-3 py-2"><input type="checkbox" aria-label="Select all orders on this page" checked={data.orders.length > 0 && data.orders.every(o => selected.includes(o.id))} onchange={(e) => selected = e.currentTarget.checked ? data.orders.map(o => o.id) : []} /></th><th class="px-3 py-2">Order</th><th class="px-3 py-2">Customer</th><th class="px-3 py-2">For</th><th class="px-3 py-2">Items</th><th class="px-3 py-2">Total</th><th class="px-3 py-2">Paid</th><th class="px-3 py-2">Status</th><th class="px-3 py-2">Preparation</th><th class="px-3 py-2">Print files</th><th class="px-3 py-2">Placed</th></tr></thead>
    <tbody>
      {#each data.orders as o (o.id)}
        <tr class="border-t border-stone-100 hover:bg-stone-50">
          <td class="px-3 py-2"><input type="checkbox" aria-label={`Select ${o.orderNumber}`} value={o.id} bind:group={selected} /></td><td class="px-3 py-2"><a href={`/admin/orders/${o.id}`} class="font-medium underline">{o.orderNumber}</a><div class="text-xs text-stone-500">{o.eventName}</div></td>
          <td class="px-3 py-2">{o.customerName}<div class="text-xs text-stone-500">{o.phone ?? ''} {o.email ?? ''}</div></td>
          <td class="px-3 py-2">{o.subjectName ?? ''}</td>
          <td class="max-w-xs truncate px-3 py-2 text-xs" title={o.itemSummary}>{o.itemSummary}</td>
          <td class="px-3 py-2">{formatCents(o.totalCents, o.currency)}</td>
          <td class="px-3 py-2">{#if o.paidCents >= o.totalCents}<span class="text-emerald-700">paid</span>{:else if o.paidCents > 0}{formatCents(o.paidCents, o.currency)}{:else}<span class="text-stone-400">—</span>{/if}</td>
          <td class="px-3 py-2"><span class={`rounded px-2 py-0.5 text-xs ${badge[o.status] ?? ''}`}>{STATUS_LABELS[o.status as keyof typeof STATUS_LABELS] ?? o.status}</span></td>
          <td class="px-3 py-2 text-xs"><a href={`/admin/orders/${o.id}#preparation`} class="font-medium underline">{FULFILLMENT_LABELS[o.work.stage]}</a><div class="mt-1 text-stone-500">{o.work.reviewed}/{o.work.photos} reviewed{o.work.requestsPending?' · special requests':''}</div></td>
          <td class="whitespace-nowrap px-3 py-2 text-xs"><span class={o.production.includes('hold') ? 'text-amber-800' : 'text-emerald-800'}>{o.production}</span></td><td class="px-3 py-2 text-xs text-stone-500">{new Date(o.createdAt).toLocaleString()}</td>
        </tr>
      {:else}
        <tr><td colspan="11" class="px-3 py-8 text-center text-stone-500">No orders match.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

{#if data.summary.count > 50}<nav class="mt-4 flex items-center justify-between" aria-label="Order pages">{#if data.filter.page > 1}<a class="button-secondary" href={pageUrl(data.filter.page - 1)}>← Previous</a>{:else}<span></span>{/if}<span class="text-sm">Page {data.filter.page} of {Math.ceil(data.summary.count / 50)}</span>{#if data.filter.page * 50 < data.summary.count}<a class="button-secondary" href={pageUrl(data.filter.page + 1)}>Next →</a>{:else}<span></span>{/if}</nav>{/if}
