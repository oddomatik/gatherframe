<script lang="ts">
  import { enhance } from '$app/forms';
  import { toast } from '$lib/client/toast.svelte';
  let { data, form } = $props();
  $effect(() => { if (form?.ok) toast(String(form.ok), 'success'); if (form?.error) toast(String(form.error), 'error', 8000); });
  const s = $derived(data.settings);
  const input = 'mt-0.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm';
</script>

<h1 class="text-2xl font-semibold">Settings</h1>
<form method="post" action="?/save" use:enhance class="mt-4 space-y-4">
  <section class="rounded-xl border border-stone-200 bg-white p-4">
    <h2 class="font-semibold">Studio</h2>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <label class="text-xs">Studio name<input name="studioName" value={s.studioName} class={input} /></label>
      <label class="text-xs">Photographer name<input name="photographerName" value={s.photographerName} class={input} /></label>
      <label class="text-xs">Contact line shown to parents<input name="contactLine" value={s.contactLine} placeholder="brian@example.com · 555-0100" class={input} /></label>
      <label class="text-xs">Your email (order notifications)<input name="adminEmail" type="email" value={s.adminEmail} class={input} /></label>
      <label class="text-xs">Currency<input name="currency" value={s.currency} class={input} /></label>
      <label class="text-xs">Order number time zone<input name="orderTz" value={s.orderTz} class={input} /></label>
    </div>
  </section>

  <section class="rounded-xl border border-stone-200 bg-white p-4">
    <h2 class="font-semibold">Payment</h2>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <label class="text-xs">Venmo handle<input name="venmoHandle" value={s.venmoHandle} placeholder="@Your-Handle" class={input} /></label>
      <label class="text-xs sm:col-span-2">Wording on the confirmation page<textarea name="paymentInstructionsMd" rows="2" class={input}>{s.paymentInstructionsMd}</textarea></label>
    </div>
  </section>

  <section class="rounded-xl border border-stone-200 bg-white p-4">
    <h2 class="font-semibold">Notifications</h2>
    <p class="text-xs text-stone-500">New orders are always in the inbox. These channels push them to you as well.</p>
    <div class="mt-3 grid gap-4 lg:grid-cols-3">
      <div class="rounded-lg border border-stone-200 p-3">
        <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="notifyGotify" checked={s.notifyGotify} /> Gotify</label>
        <label class="mt-2 block text-xs">Server URL<input name="gotifyUrl" value={s.gotify?.url ?? ''} placeholder="https://gotify.example.com" class={input} /></label>
        <label class="mt-2 block text-xs">App token<input name="gotifyToken" value={s.gotify?.token ?? ''} autocomplete="off" class={input} /></label>
        <label class="mt-2 block text-xs">Priority<input name="gotifyPriority" value={s.gotify?.priority ?? 5} class={input} /></label>
        {#if !data.allowPrivate}<p class="mt-2 text-[11px] text-stone-500">LAN address? Set GOTIFY_ALLOW_PRIVATE=1 in the environment.</p>{/if}
      </div>
      <div class="rounded-lg border border-stone-200 p-3">
        <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="notifyEmail" checked={s.notifyEmail} /> Email (SMTP)</label>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <label class="col-span-2 text-xs">Host<input name="smtpHost" value={s.smtp?.host ?? ''} class={input} /></label>
          <label class="text-xs">Port<input name="smtpPort" value={s.smtp?.port ?? 587} class={input} /></label>
        </div>
        <label class="mt-2 block text-xs">User<input name="smtpUser" value={s.smtp?.user ?? ''} autocomplete="off" class={input} /></label>
        <label class="mt-2 block text-xs">Password<input name="smtpPass" type="password" value={s.smtp?.pass ?? ''} autocomplete="new-password" class={input} /></label>
        <label class="mt-2 block text-xs">From<input name="smtpFrom" value={s.smtp?.from ?? ''} placeholder="Studio <noreply@example.com>" class={input} /></label>
        <label class="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="smtpSecure" checked={s.smtp?.secure ?? false} /> TLS on connect (port 465)</label>
      </div>
      <div class="rounded-lg border border-stone-200 p-3">
        <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="notifyWebhook" checked={s.notifyWebhook} /> Webhook</label>
        <label class="mt-2 block text-xs">URL<input name="webhookUrl" value={s.webhook?.url ?? ''} class={input} /></label>
        <label class="mt-2 block text-xs">Secret (HMAC-SHA256 of timestamp.body)<input name="webhookSecret" value={s.webhook?.secret ?? ''} autocomplete="off" class={input} /></label>
        <p class="mt-2 text-[11px] text-stone-500">Headers: X-Webhook-Event, X-Webhook-Timestamp, X-Webhook-Signature.</p>
      </div>
    </div>
  </section>
  <div class="flex gap-2">
    <button class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white">Save settings</button>
  </div>
</form>
<div class="mt-2 flex gap-2">
  <form method="post" action="?/test" use:enhance><button class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm">Send test notification</button></form>
  <form method="post" action="?/retry" use:enhance><button class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm">Retry failed deliveries</button></form>
</div>

<section class="mt-6 rounded-xl border border-stone-200 bg-white p-4">
  <h2 class="font-semibold">Recent deliveries</h2>
  <ul class="mt-2 divide-y divide-stone-100 text-xs">
    {#each data.deliveries as d (d.id)}
      <li class="flex flex-wrap gap-2 py-1.5"><span class="text-stone-500">{new Date(d.createdAt).toLocaleString()}</span><span>{d.eventType}</span><span class="text-stone-600">{d.recipient}</span><span class={`ml-auto ${d.status === 'sent' ? 'text-emerald-700' : d.status === 'dead' ? 'text-red-700' : 'text-amber-700'}`}>{d.status} ({d.attempts})</span>{#if d.lastError}<span class="w-full text-red-700">{d.lastError}</span>{/if}</li>
    {:else}<li class="py-3 text-stone-500">Nothing sent yet.</li>{/each}
  </ul>
  <h3 class="mt-4 text-sm font-semibold">Background jobs</h3>
  <p class="text-xs text-stone-600">{data.jobs.length ? data.jobs.map((j) => `${j.type}: ${j.n} ${j.status}`).join(' · ') : 'queue is empty'}</p>
  <p class="mt-2 text-xs text-stone-500">Public origin used in links: <code>{data.publicOrigin}</code> (PUBLIC_ORIGIN).</p>
</section>
