<script lang="ts">
  import GuestActivity from '$lib/components/GuestActivity.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { page } from '$app/state';
  let { data, children } = $props();
</script>

<svelte:head>
  {#if data.linkPreview}
    <meta property="og:type" content="website" />
    <meta property="og:title" content={data.linkPreview.title} />
    <meta property="og:description" content={data.linkPreview.description} />
    <meta property="og:url" content={data.linkPreview.url} />
    <meta property="og:image" content={data.linkPreview.imageUrl} />
    <meta property="og:image:secure_url" content={data.linkPreview.imageUrl} />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content={data.linkPreview.alt} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={data.linkPreview.title} />
    <meta name="twitter:description" content={data.linkPreview.description} />
    <meta name="twitter:image" content={data.linkPreview.imageUrl} />
    <meta name="twitter:image:alt" content={data.linkPreview.alt} />
  {/if}
</svelte:head>

<Toasts />
<GuestActivity slug={data.event.slug} enabled={data.access === 'ok' && !data.isAdminPreview && page.status === 200} />
<div class="parent-shell">
{#if data.access === 'locked'}
  <main class="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center px-4 py-10">
    <h1 class="text-2xl font-semibold">{data.event.name}</h1>
    <p class="mt-1 text-sm text-stone-600">Enter the password from your invitation to view the photos.</p>
    <form method="post" action={`/g/${data.event.slug}/unlock`} class="mt-6 space-y-3">
      <input type="hidden" name="redirectTo" value={page.url.pathname + page.url.search} />
      <label for="gallery-password" class="block text-sm font-medium">Gallery password</label>
      <input id="gallery-password" name="password" type="password" autocomplete="current-password" required
        class="w-full rounded-lg border border-stone-300 px-3 py-3 text-base" placeholder="Password" />
      {#if data.unlockError}<p class="text-sm text-red-600">That password is not right. Try again.</p>{/if}
      <button class="w-full rounded-lg bg-stone-900 px-4 py-3 text-base font-medium text-white">Open gallery</button>
    </form>
    {#if data.studio.contact}<p class="mt-8 text-xs text-stone-500">{data.studio.name} · {data.studio.contact}</p>{/if}
  </main>
{:else if data.access === 'expired'}
  <main class="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center px-4 py-10 text-center">
    <h1 class="text-xl font-semibold">This gallery has closed</h1>
    <p class="mt-2 text-sm text-stone-600">The photos for {data.event.name} are no longer online.</p>
    {#if data.studio.contact}<p class="mt-4 text-sm">Contact {data.studio.photographer || data.studio.name}: {data.studio.contact}</p>{/if}
  </main>
{:else}
  {#if data.isAdminPreview}
    <div class="bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">Photographer preview · your admin access bypasses passwords and publishing restrictions.</div>
  {/if}
  {#if data.event.parentMessage}<aside class="mx-auto mt-5 max-w-5xl px-4"><div class="notice whitespace-pre-line text-sm"><p class="eyebrow mb-2">A note from the studio</p>{data.event.parentMessage}</div></aside>{/if}
  {@render children()}
{/if}

</div>
