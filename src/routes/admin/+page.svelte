<script lang="ts">
  let { data, form } = $props();
</script>
<h1 class="text-2xl font-semibold">Events</h1>

{#if !data.setup.gotify && !data.setup.smtp}
  <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">You will not be notified of new orders yet. Add Gotify or SMTP in <a href="/admin/settings" class="underline">Settings</a>. Orders always appear in the inbox regardless.</p>
{/if}

<form method="post" action="?/create" class="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3">
  <label class="text-sm">Name<input name="name" required class="mt-1 block rounded-lg border border-stone-300 px-3 py-2" placeholder="Autumn collection" /></label>
  <label class="text-sm">Date<input name="eventDate" type="date" class="mt-1 block rounded-lg border border-stone-300 px-3 py-2" /></label>
  <label class="text-sm">Order reference label<input name="subjectLabel" maxlength="80" placeholder="Order reference" class="mt-1 block rounded-lg border border-stone-300 px-3 py-2" /></label>
  {#if data.catalogs.length > 1}<label class="text-sm">Catalog<select name="catalogId" class="mt-1 block rounded-lg border border-stone-300 px-3 py-2">{#each data.catalogs as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>{/if}
  <button class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white">Create event</button>
  {#if form?.error}<p class="w-full text-sm text-red-600">{form.error}</p>{/if}
</form>

<ul class="mt-6 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
  {#each data.events as ev (ev.id)}
    <li>
      <a href={`/admin/events/${ev.id}`} class="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-stone-50">
        <span class="font-medium">{ev.name}</span>
        <span class="text-xs text-stone-500">{ev.eventDate ?? ''}</span>
        <span class={`rounded px-2 py-0.5 text-xs ${ev.isPublished ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>{ev.isPublished ? 'published' : 'draft'}</span>
        <span class="ml-auto text-sm text-stone-600">{ev.galleryCount} collection{ev.galleryCount === 1 ? '' : 's'} · {ev.photoCount} photos</span>
        {#if ev.newOrders > 0}<span class="rounded-full bg-amber-500 px-2 text-xs font-semibold">{ev.newOrders} new</span>{/if}
      </a>
    </li>
  {:else}
    <li class="px-4 py-8 text-center text-sm text-stone-500">No events yet. Create one above.</li>
  {/each}
</ul>
