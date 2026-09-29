<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';

  let { data, form } = $props();
  let choice = $state<'local' | 'b2' | 'mirror'>('local');
  let busy = $state<'test' | 'save' | null>(null);
  const storage = $derived(data.storage);
  const b2Ready = $derived(storage.configured && !!storage.testedAt);
  $effect(() => { choice = data.storage.mode; });
  const submit = (action: 'test' | 'save'): SubmitFunction => () => {
    busy = action;
    return async ({ update, result }) => {
      try {
        await update();
        // A failed retest revokes the previous successful check on the server.
        if (result.type === 'failure') await invalidateAll();
      } finally { busy = null; }
    };
  };
  const choices = [
    { value: 'local', title: 'On this server', description: 'Keep new photo files on your server. No B2 account is needed.' },
    { value: 'b2', title: 'In Backblaze B2', description: 'Keep new photo files in your private B2 bucket. The server still needs temporary working space.' },
    { value: 'mirror', title: 'B2 + a local copy', description: 'Keep new photo files in B2 and on this server. Uses local disk space too.' }
  ] as const;
</script>

<svelte:head><title>Photo storage · Gatherframe</title></svelte:head>

<div class="mx-auto max-w-3xl">
  <p class="text-xs font-semibold uppercase tracking-wider text-stone-500">Your studio</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">A home for your photos</h1>
  <p class="mt-2 text-sm leading-relaxed text-stone-600">Choose where new files are kept. Your Lightroom uploads, collections, and photo links work the same way whichever option you choose.</p>

  {#if form?.ok}
    <p role="status" class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{form.ok}</p>
  {/if}
  {#if form?.error}
    <p role="alert" class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{form.error}</p>
  {/if}

  <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Backblaze B2 connection</h2>
      <span class={`rounded-full px-3 py-1 text-xs font-semibold ${b2Ready ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
        {b2Ready ? 'Connection checked' : storage.configured ? 'Ready to test' : 'Not connected yet'}
      </span>
    </div>
    {#if storage.configured}
      <p class="mt-2 text-sm text-stone-600">Your server has B2 settings. Test them before choosing B2 for new files.</p>
    {:else}
      <p class="mt-2 text-sm text-stone-600">Local storage is ready to use. To enable B2, add a private bucket and its application key to the server’s environment, then restart the app.</p>
    {/if}
    <dl class="mt-4 grid gap-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-[6rem_1fr]">
      <dt class="text-stone-500">Endpoint</dt><dd class="break-all font-mono text-xs sm:self-center">{storage.endpoint || 'Not set'}</dd>
      <dt class="text-stone-500">Bucket</dt><dd class="break-all">{storage.bucket || 'Not set'}</dd>
      <dt class="text-stone-500">Folder prefix</dt><dd class="break-all">{storage.prefix || 'Bucket root'}</dd>
      {#if storage.testedAt}<dt class="text-stone-500">Last checked</dt><dd>{new Date(storage.testedAt).toLocaleString()}</dd>{/if}
    </dl>
    <form method="post" action="?/test" use:enhance={submit('test')} class="mt-4">
      <button disabled={!storage.configured || busy !== null} class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
        {busy === 'test' ? 'Checking connection…' : 'Test connection'}
      </button>
      <p class="mt-2 text-xs leading-relaxed text-stone-500">Uploads a tiny private test file, reads it back to verify it, then removes it. Your photographs are not changed. Run a fresh test before choosing B2 if the last check was more than a day ago.</p>
    </form>
    <details class="mt-4 border-t border-stone-100 pt-4">
      <summary class="cursor-pointer text-sm font-medium">Server setup details</summary>
      <div class="mt-3 space-y-2 text-sm leading-relaxed text-stone-600">
        <p>Use a private B2 bucket and an application key restricted to that bucket. Set <code>B2_ENDPOINT</code>, <code>B2_REGION</code>, <code>B2_BUCKET</code>, <code>B2_KEY_ID</code>, and <code>B2_APPLICATION_KEY</code> in the server environment. <code>B2_PREFIX</code> optionally gives this app its own folder.</p>
        <p>Keep credentials in the server’s private environment file or secret manager. They are never entered on this page or shown to visitors.</p>
        <p>The repository guide <code>docs/b2-storage.md</code> has the full setup instructions.</p>
      </div>
    </details>
  </section>

  <form method="post" action="?/save" use:enhance={submit('save')} class="mt-6">
    <fieldset disabled={busy !== null}>
      <legend class="text-lg font-semibold">Where should new files go?</legend>
      <div class="mt-3 space-y-3">
        {#each choices as option (option.value)}
          <label class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${choice === option.value ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-white'} ${option.value !== 'local' && !b2Ready ? 'opacity-60' : ''}`}>
            <input type="radio" name="mode" value={option.value} bind:group={choice} disabled={option.value !== 'local' && !b2Ready} class="mt-1 accent-stone-900" />
            <span>
              <span class="block font-semibold">{option.title}</span>
              <span class="mt-1 block text-sm leading-relaxed text-stone-600">{option.description}</span>
              {#if option.value === storage.mode}<span class="mt-2 inline-block rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-stone-600">Current choice</span>{/if}
            </span>
          </label>
        {/each}
      </div>
      <p class="mt-3 text-sm leading-relaxed text-stone-600">This changes where new files are written. Existing photos stay where they are; nothing is automatically moved or deleted. Switching back to local storage does not download files already in B2.</p>
      {#if !b2Ready}<p class="mt-2 text-xs text-stone-500">The B2 choices unlock after a successful connection test. Local storage is always available.</p>{/if}
      <button disabled={choice !== 'local' && !b2Ready} class="mt-4 rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save storage choice'}</button>
    </fieldset>
  </form>

  <section class="mb-6 mt-6 rounded-2xl bg-stone-100 p-5">
    <h2 class="text-sm font-semibold">Tracked storage files</h2>
    <dl class="mt-3 grid grid-cols-2 gap-4">
      <div><dt class="text-xs text-stone-600">Stored locally</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{storage.counts.local.toLocaleString()}</dd></div>
      <div><dt class="text-xs text-stone-600">Stored in B2</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{storage.counts.remote.toLocaleString()}</dd></div>
    </dl>
    <p class="mt-3 text-xs leading-relaxed text-stone-600">These are tracked file counts, not photo counts: a photo can have several sizes and copies. Older local files may not yet appear in these counts. Keep your database backed up too—it holds your collections, orders, and the links to your files.</p>
  </section>
</div>

<section class="mt-6 rounded-xl border border-stone-200 bg-white p-4" aria-label="Backup recovery">
  <h2 class="font-semibold">Off-server backup</h2>
  {#if data.backup}<p class="mt-2 text-sm">Last restored and verified: <time datetime={data.backup.completedAt}>{data.backup.completedAt.slice(0,16).replace('T',' ')} UTC</time> · {data.backup.objects} files</p>{#if data.backup.stale}<p role="status" class="mt-2 text-sm text-amber-900">The latest verified backup is over 36 hours old. Check the backup controller.</p>{/if}
  {:else}<p class="mt-2 text-sm text-stone-600">No verified off-server backup has been reported yet.</p>{/if}
</section>
