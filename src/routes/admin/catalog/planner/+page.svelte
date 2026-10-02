<script lang="ts">
  import { onMount } from 'svelte';
  import PrintPlanSheet from '$lib/components/PrintPlanSheet.svelte';
  import { INCH, MAX_PRINTS, PAPERS, defaultMargins, measure, planPrints, productCounts, templateCounts, layoutHandoff } from '$shared/print-planner';
  import type { Paper, Margins } from '$shared/print-planner';

  let { data } = $props();
  const initial = () => {
    const template = data.initialTemplate && data.catalog.sheets[data.initialTemplate];
    if (template) return { source: `template:${template.code}`, counts: templateCounts(template) };
    const product = data.catalog.products.find(p => String(p.id) === data.initialProduct)
      ?? data.catalog.products.find(p => p.code === 'pkg_deluxe') ?? data.catalog.products[0];
    return product ? { source: `product:${product.id}`, counts: productCounts(product, data.catalog) } : { source: '', counts: {} };
  };
  let source = $state('');
  let counts = $state<Record<string, number>>({});
  let paperCode = $state('a3plus');
  let customWidth = $state(329000), customHeight = $state(483000);
  let landscape = $state(false), rotate = $state(true);
  let margins = $state<Margins>(defaultMargins());
  let gap = $state(INCH / 8);
  let unit = $state<'in' | 'mm'>('in');
  let selectedIndex = $state(0), sheetIndex = $state(0), selectedCell = $state('');
  let notice = $state('');
  let loaded = $state(false);
  let showControls = $state(true);
  onMount(() => { const preset = initial(); source = preset.source; counts = preset.counts; loaded = true; showControls = !window.matchMedia('(max-width:850px)').matches; });
  const oriented = (p: Paper): Paper => landscape ? { ...p, width: p.height, height: p.width } : p;
  let paper = $derived(oriented(paperCode === 'custom' ? { code: 'custom', label: 'Custom paper', width: customWidth, height: customHeight } : PAPERS.find(p => p.code === paperCode)!));
  let settings = $derived({ paper, margins, gap, rotate });
  let result = $derived(planPrints(data.catalog.printSizes, counts, settings));
  let plan = $derived(result.plans[selectedIndex] ?? result.plans[0]);
  let cells = $derived(plan?.pages[sheetIndex] ?? plan?.pages[0] ?? []);
  let cell = $derived(cells.find(c => c.id === selectedCell));
  let total = $derived(Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0));
  let comparisons = $derived(PAPERS.map(p => ({ paper: oriented(p), result: planPrints(data.catalog.printSizes, counts, { ...settings, paper: oriented(p) }) })));
  let handoff = $derived(plan ? layoutHandoff(plan, settings, unit) : '');
  let sourceTemplates = $derived(source.startsWith('template:') ? [data.catalog.sheets[source.slice(9)]].filter(Boolean)
    : (data.catalog.products.find(p => `product:${p.id}` === source)?.sheets.map(s => data.catalog.sheets[s.templateCode]).filter(Boolean) ?? []));
  let hasChoices = $derived(sourceTemplates.some(t => t.cells.some(c => c.sizeOptions && c.sizeOptions.length > 1)));
  const fmt = (n: number, digits = 4) => measure(n, unit, digits);
  const fromInput = (event: Event) => Math.round((event.target as HTMLInputElement).valueAsNumber * (unit === 'in' ? INCH : 1000));
  function resetSelection() { selectedIndex = 0; sheetIndex = 0; selectedCell = ''; notice = ''; }
  function loadSource(value: string) {
    source = value;
    if (value.startsWith('product:')) { const p = data.catalog.products.find(p => `product:${p.id}` === value); counts = p ? productCounts(p, data.catalog) : {}; }
    else { const t = data.catalog.sheets[value.slice(9)]; counts = t ? templateCounts(t) : {}; }
    resetSelection();
  }
  function quantity(code: string, value: number) { counts = { ...counts, [code]: value }; resetSelection(); }
  function download() {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([handoff], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'gatherframe-layout-reference.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice = 'Layout reference downloaded. Your catalog is unchanged.';
  }
  async function copy() {
    try { await navigator.clipboard.writeText(handoff); notice = 'Measurements copied. Your catalog is unchanged.'; }
    catch { notice = 'Clipboard is unavailable here. Use Download reference instead.'; }
  }
</script>

<svelte:head><title>Print planner · Gatherframe</title></svelte:head>
<div class="planner">
  <a class="back" href="/admin/catalog">← Catalog</a>
  <header>
    <div><p class="eyebrow">Studio tool · Optional</p><h1>Print package planner</h1><p class="intro">Explore paper and full-size print layouts. Take the measurements to Lightroom when you’re ready.</p></div>
    <div class="unit-control" role="group" aria-label="Measurement units"><button class:chosen={unit === 'in'} aria-pressed={unit === 'in'} onclick={() => unit = 'in'}>Inches</button><button class:chosen={unit === 'mm'} aria-pressed={unit === 'mm'} onclick={() => unit = 'mm'}>Millimetres</button></div>
  </header>
  <button class="controls-toggle" aria-expanded={showControls} aria-controls="planner-controls" onclick={() => showControls = !showControls}>{showControls ? 'Hide package & paper settings' : `Edit package & paper · ${total} prints`}</button>
  <div class="workspace">
    <aside id="planner-controls" class="controls" class:collapsed={!showControls} aria-label="Package and paper settings">
      <section>
        <div class="section-title"><h2>01 / The package</h2><span>{total} prints</span></div>
        <label class="field">Start from an offering or suggestion
          <select aria-label="Start from an offering or suggestion" value={source} onchange={e => loadSource(e.currentTarget.value)}>
            <option value="">Empty package</option>
            <optgroup label="Your offerings">{#each data.catalog.products as p}<option value={`product:${p.id}`}>{p.name}</option>{/each}</optgroup>
            <optgroup label="Existing layout suggestions">{#each Object.values(data.catalog.sheets) as t}<option value={`template:${t.code}`}>{t.label}</option>{/each}</optgroup>
          </select>
        </label>
        <div class="quantities">{#each data.catalog.printSizes as s}<label><span>{s.label.replaceAll('x', ' × ')}</span><input aria-label={`Quantity: ${s.label}`} type="number" min="0" max={MAX_PRINTS} step="1" value={counts[s.code] ?? 0} oninput={e => quantity(s.code, e.currentTarget.valueAsNumber)} /></label>{/each}</div>
        {#if hasChoices}<p class="hint">This offering has a size choice. The starting counts use its default size; adjust the quantities to explore the alternative.</p>{/if}
        <p class="hint">Experiment freely. These quantities do not edit the offering.</p>
      </section>
      <section>
        <h2>02 / Paper & cutting space</h2>
        <label class="field">Paper size<select aria-label="Paper size" bind:value={paperCode} onchange={resetSelection}>{#each PAPERS as p}<option value={p.code}>{p.label}</option>{/each}<option value="custom">Custom dimensions</option></select></label>
        {#if paperCode === 'custom'}<div class="two-up"><label class="field">Paper width ({unit})<input type="number" min="0.001" step="any" value={fmt(customWidth, 6)} oninput={e => { customWidth = fromInput(e); resetSelection(); }} /></label><label class="field">Paper height ({unit})<input type="number" min="0.001" step="any" value={fmt(customHeight, 6)} oninput={e => { customHeight = fromInput(e); resetSelection(); }} /></label></div>{/if}
        <p class="paper-dimensions">{fmt(paper.width)} × {fmt(paper.height)} {unit}</p>
        {#if paperCode === 'a3plus'}<p class="hint">Exact stock size: 329 × 483 mm. The “13 × 19” label is rounded.</p>{/if}
        <label class="check"><input type="checkbox" bind:checked={landscape} onchange={resetSelection} /> Landscape sheet</label>
        <div class="two-up margins">{#each ['top', 'right', 'bottom', 'left'] as side}<label class="field">{side[0].toUpperCase() + side.slice(1)} margin ({unit})<input type="number" min="0" step="any" value={fmt(margins[side as keyof Margins], 6)} oninput={e => { margins = { ...margins, [side]: fromInput(e) }; resetSelection(); }} /></label>{/each}</div>
        <label class="field">Minimum cutting gap ({unit})<input type="number" min="0" step="any" value={fmt(gap, 6)} oninput={e => { gap = fromInput(e); resetSelection(); }} /></label>
        <label class="check"><input type="checkbox" bind:checked={rotate} onchange={resetSelection} /> Allow 90° print rotation</label>
        <p class="hint">Margins are planning inputs, not a printer profile. Cutting gaps are white spacing, not bleed.</p>
      </section>
    </aside>

    <main class="results" aria-label="Layout suggestions">
      {#if plan}
        <div class="result-heading"><div><p class="eyebrow">Best found on this paper</p><h2>{plan.pages.length} {plan.pages.length === 1 ? 'sheet' : 'sheets'}. Every print full-size.</h2></div><span class="status">Fits entered margins</span></div>
        <div class="stats"><div><strong>{total}</strong><span>finished prints</span></div><div><strong>{Math.round(plan.utilization * 100)}%</strong><span>paper area used</span></div><div><strong>{fmt(gap)}</strong><span>{unit} cutting gap</span></div></div>
        <div class="alternatives" role="group" aria-label="Choose an arrangement">{#each result.plans as candidate, i}<button class:selected={candidate === plan} aria-pressed={candidate === plan} onclick={() => { selectedIndex = i; sheetIndex = 0; selectedCell = ''; }} aria-label={`Layout ${i + 1}, ${candidate.pages.length} sheets, ${candidate.label}`}><div class="mini"><PrintPlanSheet {paper} {margins} cells={candidate.pages[0]} miniature /></div><span><strong>Layout {i + 1}</strong><small>{candidate.pages.length} {candidate.pages.length === 1 ? 'sheet' : 'sheets'} · {candidate.label}</small></span></button>{/each}</div>
        <div class="drawing">
          <div class="drawing-toolbar"><span>{paper.label}</span><span>{fmt(paper.width)} × {fmt(paper.height)} {unit}</span></div>
          <div class="paper-wrap"><PrintPlanSheet {paper} {margins} {cells} selected={selectedCell} onselect={id => selectedCell = id} /></div>
          <div class="drawing-footer"><span>Hatched edge = margin · White space = cut spacing</span><span>Diagram shown to scale, not actual size</span></div>
          {#if plan.pages.length > 1}<nav class="sheet-nav" aria-label="Sheets">{#each plan.pages as _, i}<button class:chosen={(sheetIndex < plan.pages.length ? sheetIndex : 0) === i} aria-pressed={(sheetIndex < plan.pages.length ? sheetIndex : 0) === i} onclick={() => { sheetIndex = i; selectedCell = ''; }}>Sheet {i + 1}</button>{/each}</nav>{/if}
        </div>
        <div class="measurement" aria-live="polite">{#if cell}<strong>{cell.label} · {cell.rotated ? 'rotated 90°' : 'upright'}</strong><span>X {fmt(cell.x)} · Y {fmt(cell.y)} · W {fmt(cell.width)} · H {fmt(cell.height)} {unit}</span>{:else}<span>Select a print to inspect its position and placed dimensions.</span>{/if}</div>
        <p class="hint">Suggested arrangements, not a guaranteed optimum. Paper use includes the full sheet; the remainder includes margins and cutting space.</p>
        {#if gap === 0 || Object.values(margins).some(n => n === 0)}<p class="caution">{gap === 0 ? 'Zero gap means shared-edge cuts. ' : ''}{Object.values(margins).some(n => n === 0) ? 'A zero margin may require borderless printing; check expansion and final size. ' : ''}Confirm the physical result before offering this package.</p>{/if}
      {:else}<div class="empty" role="status"><h2>{loaded ? 'Let’s find a workable fit.' : 'Loading the package…'}</h2>{#if loaded}<p>{result.error}</p><p class="hint">Prints are never shrunk or omitted to make a layout fit.</p>{/if}</div>{/if}

      <section class="compare"><h2>Compare paper sizes</h2><p class="hint">Same package, margins, gaps and rotation setting. Each option uses one stock size throughout.</p><div class="paper-options">{#each comparisons as comparison}{@const best = comparison.result.plans[0]}<button class:chosen={paperCode === comparison.paper.code} onclick={() => { paperCode = comparison.paper.code; resetSelection(); }} aria-label={`Explore ${comparison.paper.label}`}><strong>{comparison.paper.label}</strong><span>{fmt(comparison.paper.width, 2)} × {fmt(comparison.paper.height, 2)} {unit}</span>{#if best}<b>{best.pages.length} {best.pages.length === 1 ? 'sheet' : 'sheets'} · {Math.round(best.utilization * 100)}% used</b>{:else}<b class="unfit">{comparison.result.unfit.length ? 'Print exceeds usable area' : 'Review inputs'}</b>{/if}</button>{/each}</div></section>

      {#if plan}<section class="handoff"><div><p class="eyebrow">03 / Take it to Lightroom</p><h2>Your layout, in measurements.</h2><p>Recreate the cells in <strong>Print → Custom Package</strong>, confirm crops and printer settings, then save a template.</p></div><div class="actions"><button class="primary" onclick={download}>Download reference</button><button onclick={copy}>Copy measurements</button></div><p class="hint">A manual layout reference, not a Lightroom import or print-ready file. Existing offers and orders stay unchanged.</p><details><summary>View placement table ({unit})</summary><div class="table-scroll"><table><thead><tr><th>Sheet</th><th>Print</th><th>X</th><th>Y</th><th>Width</th><th>Height</th><th>Rotation</th></tr></thead><tbody>{#each plan.pages as pageCells, i}{#each pageCells as c}<tr><td>{i + 1}</td><td>{c.label}</td><td>{fmt(c.x)}</td><td>{fmt(c.y)}</td><td>{fmt(c.width)}</td><td>{fmt(c.height)}</td><td>{c.rotated ? '90°' : '0°'}</td></tr>{/each}{/each}</tbody></table></div><p class="hint">X and Y are measured from the top-left of the physical sheet.</p></details></section>{/if}
      <p class="notice" role="status">{notice}</p>
      <p class="hint">References: <a href="https://ij.manual.canon/ij/webmanual/Manual/All/TA-30/EN/LBGA/lbga_tp000146.html" target="_blank" rel="noopener noreferrer">Canon paper dimensions</a> · <a href="https://helpx.adobe.com/lightroom-classic/desktop/print-photos/print-module-layouts-templates.html" target="_blank" rel="noopener noreferrer">Adobe custom print layouts</a></p>
    </main>
  </div>
</div>

<style>
  .planner { max-width:1320px; margin:0 auto; color:#36382f; }
  .back { font-size:13px; color:#67695e; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:28px 0; }
  .eyebrow { font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:#647260; margin:0 0 9px; }
  h1 { font-family:Georgia,serif; font-size:clamp(27px,3vw,40px); font-weight:400; line-height:1.15; letter-spacing:-.03em; }
  .intro { color:#73756a; font-size:14px; margin-top:10px; max-width:620px; }
  h2 { font-size:15px; font-weight:650; }
  .unit-control, .sheet-nav { display:flex; gap:4px; flex-wrap:wrap; }
  button { border:1px solid #d9d9cd; background:#fff; border-radius:7px; padding:10px 13px; font-size:12px; cursor:pointer; }
  button:hover { border-color:#75836b; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid #536a51; outline-offset:3px; }
  .chosen { background:#edf1e9; border-color:#819377; }
  .workspace { display:grid; grid-template-columns:280px minmax(0,1fr); gap:28px; align-items:start; }
  .controls-toggle { display:none; }
  .hint a { text-decoration:underline; }
  .controls { border:1px solid #e0e0d6; background:#fafaf6; border-radius:12px; overflow:hidden; }
  .controls section { padding:20px; }
  .controls section + section { border-top:1px solid #e0e0d6; }
  .section-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .section-title span { font-size:11px; color:#777b6f; }
  .field { display:block; font-size:11px; margin:15px 0 0; color:#626756; }
  input[type=number], select { display:block; border:1px solid #d9dccf; border-radius:6px; background:white; padding:8px; width:100%; min-width:0; font-size:13px; color:#353d30; min-height:38px; }
  select { margin-top:5px; text-overflow:ellipsis; }
  .quantities { margin:16px 0; }
  .quantities label { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:4px 0; font-size:13px; }
  .quantities input { width:64px; }
  .hint { font-size:11px; line-height:1.55; color:#74786b; margin-top:10px; }
  .paper-dimensions { font-size:16px; font-variant-numeric:tabular-nums; margin-top:10px; }
  .two-up { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .check { display:flex; align-items:center; gap:8px; margin-top:14px; font-size:12px; min-height:28px; }
  .check input { accent-color:#4e694a; }
  .result-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .result-heading h2 { font-family:Georgia,serif; font-size:25px; font-weight:400; }
  .status { font-size:10px; background:#e9f0e4; color:#4b663f; border-radius:20px; padding:7px 10px; white-space:nowrap; }
  .stats { display:flex; gap:36px; padding:18px 0; }
  .stats strong { display:block; font-size:20px; font-weight:500; }
  .stats span { display:block; color:#838477; font-size:11px; margin-top:3px; }
  .alternatives { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:0 0 16px; }
  .alternatives button { display:flex; align-items:center; gap:12px; text-align:left; padding:10px; }
  .alternatives .selected { border-color:#708667; background:#f1f4ed; }
  .alternatives strong, .alternatives small { display:block; }
  .alternatives small { font-size:10px; color:#78806e; margin-top:3px; }
  .mini { width:32px; flex:none; }
  .drawing { background:#f1f0eb; border:1px solid #deddd4; border-radius:12px; padding:18px; }
  .drawing-toolbar, .drawing-footer { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size:11px; color:#72796a; }
  .paper-wrap { max-width:380px; width:100%; margin:24px auto; }
  .drawing-footer { font-size:10px; }
  .sheet-nav { justify-content:center; margin-top:14px; }
  .measurement { display:flex; justify-content:space-between; flex-wrap:wrap; gap:5px; font-size:12px; min-height:48px; align-items:center; padding:8px 0; }
  .measurement span { color:#6d7563; }
  .caution { font-size:12px; background:#fcf4df; border-radius:7px; padding:12px; margin-top:12px; }
  .empty { padding:40px 24px; background:#f6f5ee; border-radius:12px; border:1px dashed #d2d3c2; }
  .empty p { font-size:14px; margin-top:12px; }
  .compare { margin-top:28px; }
  .paper-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:14px; }
  .paper-options button { text-align:left; padding:12px; }
  .paper-options strong, .paper-options span, .paper-options b { display:block; }
  .paper-options span { font-size:10px; color:#838475; margin:5px 0 10px; }
  .paper-options b { font-size:11px; font-weight:500; color:#53694a; }
  .paper-options b.unfit { color:#827e72; }
  .handoff { border-top:1px solid #dedfd3; padding-top:24px; margin-top:28px; }
  .handoff h2 { font-family:Georgia,serif; font-size:24px; font-weight:400; }
  .handoff p:not(.eyebrow):not(.hint) { font-size:13px; line-height:1.6; margin-top:8px; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
  .primary { color:white; background:#465b3e; border-color:#465b3e; }
  details { margin-top:18px; font-size:12px; }
  summary { cursor:pointer; padding:10px 0; }
  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; white-space:nowrap; }
  th,td { text-align:left; border-bottom:1px solid #e2e4d9; padding:8px; font-size:11px; }
  .notice { min-height:24px; font-size:12px; margin-top:12px; color:#526848; }
  @media(max-width:1150px) { .workspace { grid-template-columns:250px minmax(0,1fr); gap:18px; } .paper-options { grid-template-columns:repeat(2,minmax(0,1fr)); } .result-heading { flex-wrap:wrap; } }
  @media(max-width:850px) { header { align-items:flex-start; flex-direction:column; } .controls-toggle { display:block; margin-bottom:16px; } .workspace { grid-template-columns:1fr; } .controls { display:grid; grid-template-columns:1fr 1fr; } .controls.collapsed { display:none; } .controls section+section { border-top:0; border-left:1px solid #e0e0d6; } .paper-wrap { max-width:360px; } }
  @media(max-width:540px) { .controls { grid-template-columns:1fr; } .controls section+section { border-top:1px solid #e0e0d6; border-left:0; } .stats { gap:28px; } .alternatives { grid-template-columns:1fr 1fr; } .alternatives button { flex-direction:column; align-items:flex-start; } .mini { width:24px; } .drawing { padding:12px; } }
</style>
