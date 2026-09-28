<script lang="ts">
  import { thumbUrl } from '$lib/client/api';
  import { formatCents } from '$shared/money';
  let { data } = $props();
  function prints(d: (typeof data.tickets)[number]['d']) {
    const lines = new Map<string, { photoId: number | null; hash: string | null; stem: string; size: string; count: number }>();
    for (const item of d.items) for (const sheet of item.sheets) for (const c of sheet.cells) {
      const size = c.sizeChoice ?? c.printSizeCode, key = `${c.photoId}:${size}`;
      const line = lines.get(key) ?? { photoId: c.photoId, hash: c.thumbHash, stem: c.photoStem, size, count: 0 };
      line.count += item.quantity; lines.set(key,line);
    }
    return [...lines.values()];
  }
</script>
<svelte:head><title>Gatherframe · print tickets</title></svelte:head>
<div class="ticket-controls mb-5 flex items-center justify-between"><h1 class="display-title text-3xl">Print job tickets</h1><button class="button-primary" onclick={() => window.print()}>Print job tickets</button></div>
{#each data.tickets as ticket (ticket.d.order.id)}
  {@const o = ticket.d.order}
  <article class="job-ticket mb-6 rounded-2xl border border-stone-200 bg-white p-6">
    <header class="flex flex-wrap items-baseline justify-between gap-3"><div><p class="eyebrow">{ticket.d.event.name}</p><h2 class="mt-1 text-2xl font-bold">{o.orderNumber}</h2><p class="mt-1">{o.customerName}{o.subjectName ? ` · ${o.subjectName}` : ''}</p></div><p class="text-sm">{o.status.replace('_',' ')} · {formatCents(Math.max(0,o.totalCents-ticket.d.paidCents),o.currency)} due</p></header>
    {#if ticket.work.editable && !ticket.work.reviewComplete}<p class="my-3 rounded-lg border border-amber-300 p-3 text-sm font-semibold">PREPARATION HOLD: {ticket.work.reviewed}/{ticket.work.photos.length} photos reviewed{!ticket.work.requestsAddressed?' · special requests pending':''}.</p>{/if}
    {#if !ticket.production.ready}<p class="my-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">HOLD: {ticket.production.conflicts.length} print selections need master-file review before production.</p>{/if}
    {#if o.status === 'cancelled'}<p class="my-3 text-lg font-bold text-red-800">CANCELLED — do not produce</p>{/if}
    <div class="mt-4 space-y-2">{#each prints(ticket.d) as line}<div class="flex items-center gap-4 border-t border-stone-100 py-2">{#if line.photoId}<img src={thumbUrl(line.photoId,line.hash)} alt="" class="h-20 w-20 object-contain" />{/if}<div class="flex-1"><strong>{line.count} × {line.size}</strong><p class="text-sm">{line.stem}</p></div><span class="text-sm">☐ Printed &nbsp; ☐ Checked</span></div>{/each}</div>
    {#each ticket.work.photos.filter(p=>p.parentNote) as p}<p class="mt-2 whitespace-pre-wrap text-sm"><strong>{p.stem} · Customer request:</strong> {p.parentNote}</p>{/each}
    {#each ticket.work.photos.filter(p=>p.note) as p}<p class="mt-2 whitespace-pre-wrap text-sm"><strong>{p.stem}:</strong> {p.note}</p>{/each}
    {#if ticket.work.extraRequests}<p class="mt-3 whitespace-pre-wrap text-sm"><strong>Additional requests:</strong> {ticket.work.extraRequests}</p>{/if}
    {#if o.notes}<p class="mt-4 text-sm"><strong>Parent note:</strong> {o.notes}</p>{/if}{#if o.adminNotes}<p class="mt-2 text-sm"><strong>My note:</strong> {o.adminNotes}</p>{/if}
    <p class="mt-5 border-t pt-3 text-sm">☐ Packed &nbsp;&nbsp; ☐ Delivered &nbsp;&nbsp; Date: ___________________</p>
  </article>
{/each}
<style>
@media print { :global(body) { background: white !important; } :global(header:has(a[href="/admin"])), :global(nav), :global(aside), .ticket-controls { display: none !important; } .job-ticket { break-after: page; border: none; margin: 0; padding: 0; } .job-ticket:last-child { break-after: auto; } }
</style>
