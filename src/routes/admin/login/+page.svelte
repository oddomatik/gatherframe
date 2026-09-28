<script lang="ts">
  import { page } from '$app/state';
  let { data, form } = $props();
</script>
<main class="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center px-4">
  {#if data.photographerAccessPending}
  <h1 class="text-2xl font-semibold">Photographer access is being set up</h1>
  <p class="mt-4 text-stone-600">We're getting things ready. Please check back soon to sign in.</p>
  {:else}
  <h1 class="text-2xl font-semibold">Sign in</h1>
  <form method="post" class="mt-6 space-y-3">
    <input type="hidden" name="next" value={page.url.searchParams.get('next') ?? '/admin'} />
    <input name="email" type="email" autocomplete="username" required placeholder="Email" class="w-full rounded-lg border border-stone-300 px-3 py-3" />
    <input name="password" type="password" autocomplete="current-password" required placeholder="Password" class="w-full rounded-lg border border-stone-300 px-3 py-3" />
    {#if form?.error}<p class="text-sm text-red-600">{form.error}</p>{/if}
    <button class="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white">Sign in</button>
  </form>
  {/if}
</main>
