<script lang="ts">
  import { toasts } from '$lib/client/toast.svelte';
</script>

<div class="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-stone-900 text-white'}`}>{t.text}</div>
  {/each}
</div>
