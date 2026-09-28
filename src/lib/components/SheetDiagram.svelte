<script lang="ts">
  import { cellPercent, resolveCellGeometry, fitPhotoToCell } from '$shared/geometry';
  import type { PrintSize, SheetCell, SheetTemplate } from '$shared/catalog';

  interface CellContent { thumb?: string | null; label?: string | null; warn?: boolean; missing?: boolean; photoWidth?: number | null; photoHeight?: number | null; }
  interface Props {
    sheet: SheetTemplate;
    sizes?: PrintSize[];
    content?: Record<number, CellContent>;
    sizeChoices?: Record<number, string | null | undefined>;
    activeCell?: number | null;
    interactive?: boolean;
    showLabels?: boolean;
    oncell?: (cellIndex: number) => void;
    class?: string;
  }
  let { sheet, sizes = [], content = {}, sizeChoices = {}, activeCell = null, interactive = false, showLabels = true, oncell, class: klass = '' }: Props = $props();

  function geo(cell: SheetCell) {
    const g = resolveCellGeometry(cell, sheet, sizeChoices[cell.cellIndex], sizes);
    return cellPercent(g, sheet);
  }
</script>

<div class={`relative w-full overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm ${klass}`}
     style={`aspect-ratio: ${sheet.paperWidthIn} / ${sheet.paperHeightIn};`} role="group" aria-label={sheet.label}>
  {#each sheet.cells as cell (cell.cellIndex)}
    {@const p = geo(cell)}
    {@const c = content[cell.cellIndex] ?? {}}
    {@const rect = resolveCellGeometry(cell, sheet, sizeChoices[cell.cellIndex], sizes)}
    {@const fit = fitPhotoToCell(c.photoWidth ?? 0, c.photoHeight ?? 0, rect.wIn, rect.hIn)}
    {@const active = activeCell === cell.cellIndex}
    <svelte:element this={interactive ? 'button' : 'div'}
      type={interactive ? 'button' : undefined}
      role={interactive ? 'button' : 'img'}
      class={`absolute flex items-center justify-center overflow-hidden text-center transition
        after:pointer-events-none after:absolute after:inset-0 after:border after:border-stone-400
        ${c.thumb ? '' : 'after:border-dashed bg-stone-50'}
        ${active ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
        ${interactive ? 'cursor-pointer active:scale-[0.98]' : ''}`}
      style={`left:${p.left}%; top:${p.top}%; width:${p.width}%; height:${p.height}%;`}
      onclick={interactive && oncell ? () => oncell(cell.cellIndex) : undefined}
      aria-label={`${cell.label}${c.label ? `: ${c.label}` : ''}${fit?.rotation ? ' — rotated 90° to fit' : ''}`}>
      {#if c.thumb}
        <img src={c.thumb} alt="" class="h-full w-full object-cover" loading="lazy" draggable="false"
          data-photo-rotation={fit?.rotation ?? 0}
          style={fit?.rotation === 90 ? `position:absolute;left:50%;top:50%;width:${100 * rect.hIn / rect.wIn}%;height:${100 * rect.wIn / rect.hIn}%;max-width:none;transform:translate(-50%,-50%) rotate(90deg);` : undefined} />
        {#if c.warn}<span class="absolute right-0.5 top-0.5 rounded bg-amber-500 px-1 text-[9px] font-semibold text-white" title="Substantial cropping remains even allowing rotation. Review framing in Lightroom.">crop</span>{/if}
        {#if c.missing}<span class="absolute inset-x-0 bottom-0 bg-red-600/90 px-1 text-[9px] font-semibold text-white">missing</span>{/if}
      {:else if showLabels}
        <span class="px-1 text-[10px] leading-tight text-stone-500 sm:text-xs">{interactive ? '+ ' : ''}{cell.sizeOptions?.length ? (sizeChoices[cell.cellIndex] ?? cell.sizeOptions.join('/')) : cell.label}</span>
      {/if}
    </svelte:element>
  {/each}
</div>
