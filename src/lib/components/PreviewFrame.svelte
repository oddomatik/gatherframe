<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  let { index, total, onprevious, onnext, children, items = [], onselect }: {
    index: number;
    total: number;
    onprevious?: () => void;
    onnext?: () => void;
    children: Snippet;
    items?: { id:number|string; label:string; thumb?:string; preview?:string }[];
    onselect?: (id:number|string)=>void;
  } = $props();

  let referenceId = $state<number|string|null>(null);
  let strip = $state<HTMLElement>();
  const reference = $derived(items.find(item => item.id === referenceId && item.preview));
  const current = $derived(items[index]);
  const filmstrip = $derived(items.slice(Math.max(0,index-8),Math.min(items.length,index+9)));
  $effect(() => {
    // Keep the current thumbnail in view without scrolling the page/dialog.
    const selectedId = current?.id;
    const target = strip;
    void tick().then(() => {
      if (selectedId === undefined || !target) return;
      const active = target.querySelector<HTMLElement>('[aria-current="true"]');
      if (!active) return;
      const outer = target.getBoundingClientRect(), inner = active.getBoundingClientRect();
      target.scrollLeft += inner.left - outer.left - (outer.width - inner.width) / 2;
    });
  });
  function compare() {
    if(reference) { referenceId = null; return; }
    if(!current?.preview) return;
    referenceId = current.id;
    onnext?.();
  }

  // Listen only inside this dialog, never on the page or an underlying modal.
  function keyboard(node: HTMLElement) {
    const dialog = node.closest('dialog');
    let active = true;
    // A picker can replace its focused tile with this frame inside an already
    // open dialog. Restore modal focus once that tile has left the DOM.
    void tick().then(() => {
      if (active && dialog?.open && !dialog.contains(document.activeElement)) dialog.querySelector<HTMLButtonElement>('button')?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (!dialog?.open || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, [role="textbox"], [role="slider"]') || target.isContentEditable || target.closest('dialog') !== dialog)) return;
      const navigate = event.key === 'ArrowLeft' ? onprevious : event.key === 'ArrowRight' ? onnext : undefined;
      if (total < 2 || !navigate) return;
      event.preventDefault();
      event.stopPropagation();
      navigate();
    };
    dialog?.addEventListener('keydown', keydown);
    return { destroy() { active = false; dialog?.removeEventListener('keydown', keydown); } };
  }
</script>

<div use:keyboard class="review-frame">
  <div class:comparing={!!reference} class="review-stage">
    {#if reference}<figure class="reference-photo"><img src={reference.preview} alt={`Reference: ${reference.label}`} /><figcaption>Reference · {reference.label}</figcaption></figure>{/if}
    <div class="review-current">
      {@render children()}
      {#if total > 1}
        {#if onprevious}<button type="button" class="preview-arrow left-2" onclick={onprevious} aria-label="Previous photo" aria-keyshortcuts="ArrowLeft"><span aria-hidden="true">‹</span></button>{/if}
        {#if onnext}<button type="button" class="preview-arrow right-2" onclick={onnext} aria-label="Next photo" aria-keyshortcuts="ArrowRight"><span aria-hidden="true">›</span></button>{/if}
      {/if}
    </div>
  </div>
  <div class="review-meta">
    {#if index >= 0 && total > 0}<p role="status" aria-live="polite" aria-atomic="true" class="text-xs tabular-nums text-stone-500">{index + 1} of {total}</p>{/if}
    {#if items.length > 1}<button type="button" class="button-quiet text-xs" aria-pressed={!!reference} disabled={!reference&&!current?.preview} onclick={compare}>{reference?'End comparison':'Compare photos'}</button>{/if}
  </div>
  {#if items.length > 1 && onselect}
    <nav bind:this={strip} aria-label="Photo filmstrip" class="photo-filmstrip">
      {#each filmstrip as item (item.id)}
        <button type="button" class:active={current?.id===item.id} aria-current={current?.id===item.id?'true':undefined} aria-label={`Preview ${item.label}`} title={item.label} onclick={()=>onselect?.(item.id)}>
          {#if item.thumb}<img src={item.thumb} alt="" loading="lazy" decoding="async" />{:else}<span>—</span>{/if}
        </button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .review-stage { background: #e9e7e1; border-radius: .75rem; overflow: hidden; }
  .review-stage.comparing { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 2px; }
  .review-current { position: relative; min-width: 0; display: grid; align-content: center; }
  .reference-photo { margin: 0; min-width: 0; display: flex; flex-direction: column; justify-content: center; background: #deded5; }
  .reference-photo img { width: 100%; height: 50dvh; object-fit: contain; }
  .reference-photo figcaption { padding: .5rem; font-size: .7rem; text-align: center; overflow-wrap: anywhere; }
  .comparing .review-current :global(img) { max-height: 50dvh; }
  .review-meta { display: flex; align-items: center; justify-content: center; gap: 1rem; min-height: 2.75rem; }
  .photo-filmstrip { display: flex; gap: .4rem; overflow-x: auto; padding: .35rem; overscroll-behavior: contain; }
  .photo-filmstrip button { flex: 0 0 64px; height: 56px; background: #eeeee7; border: 2px solid transparent; border-radius: .35rem; overflow: hidden; }
  .photo-filmstrip button.active { border-color: #285a4d; box-shadow: 0 0 0 2px #fff; }
  .photo-filmstrip img { width: 100%; height: 100%; object-fit: contain; }
  @media (max-width: 600px) { .reference-photo img { height: 32dvh; } .comparing .review-current :global(img) { max-height: 32dvh; } .photo-filmstrip button { flex-basis: 52px; height: 48px; } }
  .preview-arrow { position: absolute; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 9999px; background: rgb(255 255 255 / 94%); color: #292524; font-size: 2rem; line-height: 1; box-shadow: 0 1px 8px #0003; }
  .preview-arrow:hover { background: white; }
  .preview-arrow:focus-visible { outline: 3px solid #d97706; outline-offset: 2px; }
</style>
