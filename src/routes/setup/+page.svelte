<script lang="ts">
  let { form } = $props();
</script>
<main class="mx-auto max-w-md px-4 py-12">
  <h1 class="text-2xl font-semibold">Set up your studio</h1>
  <p class="mt-1 text-sm text-stone-600">Create the photographer login. You can change everything later in Settings.</p>
  <form method="post" class="mt-6 space-y-4">
    <label class="block text-sm">Studio name<input name="studioName" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="Andrus Photography" /></label>
    <label class="block text-sm">Your email<input name="email" type="email" required class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" /></label>
    <label class="block text-sm">Password (10+ characters)<input name="password" type="password" required minlength="10" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" /></label>
    <label class="block text-sm">Venmo handle (optional)<input name="venmoHandle" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="@Your-Handle" /></label>
    {#if form?.error}<p class="text-sm text-red-600">{form.error}</p>{/if}
    <button class="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white">Create studio</button>
  </form>
</main>
