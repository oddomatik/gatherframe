<script lang="ts">
  import type { Snippet } from 'svelte';
  import { dismissOnBackdrop } from '$lib/client/dialog-backdrop';
  interface Props { open: boolean; title?: string; onclose: () => void; children: Snippet; wide?: boolean; centered?: boolean; }
  let { open, title = '', onclose, children, wide = false, centered = false }: Props = $props();
  let dialog: HTMLDialogElement;
  const titleId = $props.id();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      const previous = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
    }
  });
</script>

<dialog bind:this={dialog} use:dismissOnBackdrop aria-labelledby={titleId} class:wide class:centered onclose={() => { if (open) onclose(); }} oncancel={(e) => { e.preventDefault(); onclose(); }}>
  {#if open}
    <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-5 py-4">
      <h2 id={titleId} class="text-lg font-semibold">{title}</h2>
      <button type="button" class="button-quiet shrink-0" onclick={onclose} aria-label={`Close ${title}`}>Close <span aria-hidden="true">×</span></button>
    </div>
    <div class="p-4 safe-bottom">{@render children()}</div>
  {/if}
</dialog>

<style>
  dialog { border: 0; padding: 0; width: min(100%, 36rem); max-width: 100%; max-height: 90dvh; margin: auto auto 0; border-radius: 1.5rem 1.5rem 0 0; background: #fffdf9; box-shadow: 0 24px 80px #263e3b33; overflow-y: auto; }
  dialog::backdrop { background: #172d2c99; backdrop-filter: blur(4px); }
  dialog.centered { margin: auto; width: min(calc(100% - 1rem), 56rem); border-radius: 1.5rem; }
  @media (min-width: 640px) { dialog { margin: auto; border-radius: 1.5rem; width: min(calc(100% - 2rem), 36rem); } dialog.wide { width: min(calc(100% - 2rem), 56rem); } }
</style>
