<script lang="ts">
  import { page } from '$app/state';
  const eventSlug = $derived(page.url.pathname.match(/^\/g\/([^/]+)/)?.[1]);
</script>
<svelte:head><title>Let’s find your photos</title></svelte:head>
<main class="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-6 text-center">
  <p class="eyebrow">A little pause · {page.status}</p>
  <h1 class="display-title mt-4 text-4xl">Let’s find your way back.</h1>
  <p class="mt-4 text-stone-600">{page.error?.message ?? 'Something went wrong. Please try again in a moment.'}</p>
  {#if eventSlug}<a href={`/g/${eventSlug}`} class="button-primary mt-6">Back to the gallery</a>{:else}<p class="mt-5 text-sm text-stone-500">Open the gallery link from your invitation to find your photos.</p>{/if}
  <button type="button" class="button-secondary mt-3" onclick={() => window.location.reload()}>Try again</button>
</main>
