<script lang="ts">
  import type { Paper, Margins, Placement } from '$shared/print-planner';
  let { paper, margins, cells, selected = '', onselect, miniature = false }: {
    paper: Paper; margins: Margins; cells: Placement[]; selected?: string;
    onselect?: (id: string) => void; miniature?: boolean;
  } = $props();
  const colors: Record<string, string> = { '8x10': '#d5dfd7', '5x7': '#e9d9c6', wallet: '#d9dfeb', mini_wallet: '#e3d8e8', '4x6': '#e9dfb8', '11x14': '#cbdedc', '12x18': '#d8dbcb' };
</script>

<div class:miniature class="sheet" style={`aspect-ratio:${paper.width}/${paper.height}`} role="group" aria-label={`${paper.label} sheet layout`}>
  <div class="usable" style={`left:${100 * margins.left / paper.width}%;top:${100 * margins.top / paper.height}%;width:${100 * (paper.width - margins.left - margins.right) / paper.width}%;height:${100 * (paper.height - margins.top - margins.bottom) / paper.height}%`}></div>
  {#each cells as c (c.id)}
    <svelte:element this={onselect ? 'button' : 'div'} type={onselect ? 'button' : undefined} role={onselect ? 'button' : 'img'}
      class="print" class:active={selected === c.id}
      style={`left:${100 * c.x / paper.width}%;top:${100 * c.y / paper.height}%;width:${100 * c.width / paper.width}%;height:${100 * c.height / paper.height}%;background:${colors[c.code] ?? '#ddd9d3'}`}
      onclick={onselect ? () => onselect?.(c.id) : undefined}
      aria-label={onselect ? `${c.label}, ${c.rotated ? 'rotated 90 degrees' : 'upright'}, select measurements` : undefined}
      aria-pressed={onselect ? selected === c.id : undefined}>
      {#if !miniature}<span>{c.label.replaceAll('x', ' × ')}{#if c.rotated}<small>↻ 90°</small>{/if}</span>{/if}
    </svelte:element>
  {/each}
</div>

<style>
  .sheet { position:relative; width:100%; background:repeating-linear-gradient(135deg,#f3f1ec 0 3px,#eae7e0 3px 4px); border:1px solid #c7c2b8; box-shadow:0 8px 30px #29251d12; }
  .usable { position:absolute; background:white; outline:1px dashed #a8a195; outline-offset:-1px; }
  .print { position:absolute; display:flex; align-items:center; justify-content:center; border:1px solid #514d414d; color:#393a33; text-align:center; padding:0; }
  button.print { cursor:pointer; }
  .print span { padding:2px; font-size:clamp(9px,1.25vw,13px); line-height:1.2; }
  .print small { display:block; margin-top:4px; font-size:10px; opacity:.7; }
  .print.active, button.print:focus-visible { outline:3px solid #4d6655; outline-offset:2px; z-index:1; }
  .miniature { box-shadow:none; pointer-events:none; }
  .miniature .print { border-width:.5px; }
  @media(max-width:600px) { .print span { font-size:12px; } }
</style>
