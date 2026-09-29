import type { Catalog, PrintSize, Product, SheetTemplate } from './catalog';

/** Integer micrometres keep stock dimensions and finished inches independent of display rounding. */
export const INCH = 25400;
export const MAX_PRINTS = 60;
export interface Paper { code: string; label: string; width: number; height: number }
export interface Margins { top: number; right: number; bottom: number; left: number }
export interface PlannerSettings { paper: Paper; margins: Margins; gap: number; rotate: boolean }
export interface Placement { id: string; code: string; label: string; x: number; y: number; width: number; height: number; rotated: boolean }
export interface LayoutPlan { id: string; label: string; pages: Placement[][]; utilization: number }
export interface PlanResult { plans: LayoutPlan[]; error: string | null; unfit: string[] }
export const PAPERS: Paper[] = [
  { code: '4x6', label: '4 × 6 in', width: 4 * INCH, height: 6 * INCH },
  { code: '5x7', label: '5 × 7 in', width: 5 * INCH, height: 7 * INCH },
  { code: '8x10', label: '8 × 10 in', width: 8 * INCH, height: 10 * INCH },
  { code: 'letter', label: 'Letter', width: 8.5 * INCH, height: 11 * INCH },
  { code: 'a4', label: 'A4', width: 210000, height: 297000 },
  { code: 'a3', label: 'A3', width: 297000, height: 420000 },
  { code: 'a3plus', label: 'A3+ · nominal 13 × 19', width: 329000, height: 483000 }
];
export const defaultMargins = (): Margins => ({ top: INCH / 4, right: INCH / 4, bottom: INCH / 4, left: INCH / 4 });
export const measure = (value: number, unit: 'in' | 'mm', digits = 4) => Number((value / (unit === 'in' ? INCH : 1000)).toFixed(digits)).toString();

export function templateCounts(template: SheetTemplate): Record<string, number> {
  const result: Record<string, number> = {};
  for (const cell of template.cells) result[cell.printSizeCode] = (result[cell.printSizeCode] ?? 0) + 1;
  return result;
}
export function productCounts(product: Product, catalog: Catalog): Record<string, number> {
  const result: Record<string, number> = {};
  for (const { templateCode } of product.sheets) {
    const template = catalog.sheets[templateCode];
    if (template) for (const [code, count] of Object.entries(templateCounts(template))) result[code] = (result[code] ?? 0) + count;
  }
  return result;
}

type Rect = { x: number; y: number; width: number; height: number };
type Item = Pick<Placement, 'id' | 'code' | 'label' | 'width' | 'height'>;
const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function subtract(free: Rect[], used: Rect): Rect[] {
  const next: Rect[] = [];
  for (const r of free) {
    if (!intersects(r, used)) { next.push(r); continue; }
    if (used.x > r.x) next.push({ ...r, width: used.x - r.x });
    if (used.y > r.y) next.push({ ...r, height: used.y - r.y });
    if (used.x + used.width < r.x + r.width) next.push({ ...r, x: used.x + used.width, width: r.x + r.width - used.x - used.width });
    if (used.y + used.height < r.y + r.height) next.push({ ...r, y: used.y + used.height, height: r.y + r.height - used.y - used.height });
  }
  return next.filter((r, i) => !next.some((s, j) => i !== j && contains(s, r) && (!contains(r, s) || j < i)));
}
const orientations = (item: Item, rotate: boolean, preferRotated: boolean) => {
  const normal = { width: item.width, height: item.height, rotated: false };
  const turned = { width: item.height, height: item.width, rotated: true };
  return rotate && item.width !== item.height ? (preferRotated ? [turned, normal] : [normal, turned]) : [normal];
};

function pack(items: Item[], settings: PlannerSettings, strategy: 'tight' | 'rows', preferred: Record<string, boolean>): Placement[][] {
  const { paper, margins: m, gap, rotate } = settings;
  const width = paper.width - m.left - m.right, height = paper.height - m.top - m.bottom;
  const pages: { cells: Placement[]; free: Rect[] }[] = [];
  for (const item of items) {
    let choice: { page: number; cell: Placement; reserved: Rect; score: number[] } | null = null;
    for (let page = 0; page <= pages.length; page++) {
      // Add a new sheet only when no placement on an existing sheet is available.
      if (page === pages.length && choice) break;
      const free = pages[page]?.free ?? [{ x: m.left, y: m.top, width: width + gap, height: height + gap }];
      for (const r of free) for (const o of orientations(item, rotate, false)) {
        const w = o.width + gap, h = o.height + gap;
        if (w > r.width || h > r.height) continue;
        const dw = r.width - w, dh = r.height - h;
        const preference = preferred[item.code] === undefined || preferred[item.code] === o.rotated ? 0 : 1;
        const score = strategy === 'tight' ? [page, preference, Math.min(dw, dh), Math.max(dw, dh), r.y, r.x] : [page, preference, r.y + h, r.x, Math.min(dw, dh)];
        const better = !choice || score.some((n, i) => n < choice!.score[i] && score.slice(0, i).every((v, j) => v === choice!.score[j]));
        if (better) choice = { page, cell: { ...item, ...o, x: r.x, y: r.y }, reserved: { x: r.x, y: r.y, width: w, height: h }, score };
      }
      if (page === pages.length) break;
    }
    if (!choice) throw new Error('Validated print has no placement.');
    if (!pages[choice.page]) pages.push({ cells: [], free: [{ x: m.left, y: m.top, width: width + gap, height: height + gap }] });
    const page = pages[choice.page];
    page.cells.push(choice.cell);
    page.free = subtract(page.free, choice.reserved);
  }
  return pages.map(p => p.cells);
}

/** Bounded, deterministic multi-start rectangle packing. Suggestions, not a proof of optimality. */
export function planPrints(sizes: PrintSize[], counts: Record<string, number>, settings: PlannerSettings): PlanResult {
  const fail = (error: string, unfit: string[] = []): PlanResult => ({ plans: [], error, unfit });
  const { paper, margins: m, gap } = settings;
  if (![paper.width, paper.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2000000)) return fail('Enter paper dimensions greater than zero and no larger than 2,000 mm.');
  if (![m.top, m.right, m.bottom, m.left, gap].every(n => Number.isSafeInteger(n) && n >= 0)) return fail('Enter non-negative margins and a cutting gap.');
  const width = paper.width - m.left - m.right, height = paper.height - m.top - m.bottom;
  if (width <= 0 || height <= 0) return fail('The margins leave no printable area.');
  const items: Item[] = [];
  for (const [code, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_PRINTS) return fail(`Use whole quantities from 0 to ${MAX_PRINTS}.`);
    if (!count) continue;
    const size = sizes.find(s => s.code === code);
    if (!size || ![size.widthIn, size.heightIn].every(n => Number.isFinite(n) && n > 0 && n * INCH <= 2000000)) return fail(`Unknown or invalid print size: ${code}.`);
    if (items.length + count > MAX_PRINTS) return fail(`Explore up to ${MAX_PRINTS} prints per package.`);
    for (let i = 0; i < count; i++) items.push({ id: `${code}-${i + 1}`, code, label: size.label, width: Math.round(size.widthIn * INCH), height: Math.round(size.heightIn * INCH) });
  }
  if (!items.length) return fail('Add at least one print to explore layouts.');
  const unfit = [...new Set(items.filter(p => !(p.width <= width && p.height <= height) && !(settings.rotate && p.height <= width && p.width <= height)).map(p => p.label))];
  if (unfit.length) return fail(`${unfit.join(', ')} exceeds the usable sheet area. Choose larger paper or review the margins.`, unfit);
  const largestArea = Math.max(...items.map(p => p.width * p.height));
  const sorters = [
    (a: Item, b: Item) => b.width * b.height - a.width * a.height,
    (a: Item, b: Item) => Math.max(b.width, b.height) - Math.max(a.width, a.height),
    (a: Item, b: Item) => b.width - a.width || b.height - a.height,
    (a: Item, b: Item) => b.height - a.height || b.width - a.width,
    // Fill beside the largest print before placing medium prints underneath it.
    (a: Item, b: Item) => Number(b.width * b.height === largestArea) - Number(a.width * a.height === largestArea) || a.width * a.height - b.width * b.height
  ];
  const seen = new Set<string>(), plans: LayoutPlan[] = [];
  const area = items.reduce((n, p) => n + p.width * p.height, 0);
  // Greedy rotation alone misses common mixes (including four wallets on a 5×7).
  // Explore per-size orientation preferences for up to four size groups, then let
  // remaining groups rotate freely. This is bounded even for large custom catalogs.
  const codes = [...new Set(items.map(p => p.code))].slice(0, 4);
  const preferences: Record<string, boolean>[] = [{}];
  if (settings.rotate) for (let mask = 0; mask < 2 ** codes.length; mask++) preferences.push(Object.fromEntries(codes.map((code, i) => [code, Boolean(mask & (1 << i))])));
  for (const sorter of sorters) for (const strategy of ['tight', 'rows'] as const) for (const preferred of preferences) {
    const pages = pack([...items].sort(sorter), settings, strategy, preferred);
    const signature = JSON.stringify(pages.map(p => p.map(c => [c.code, c.x, c.y, c.width, c.height]).sort()).sort());
    if (seen.has(signature)) continue;
    seen.add(signature);
    plans.push({ id: `layout-${plans.length}`, label: strategy === 'tight' ? 'Compact arrangement' : 'Row-first arrangement', pages, utilization: area / (paper.width * paper.height * pages.length) });
  }
  const footprint = (p: LayoutPlan) => p.pages.reduce((n, cells) => n + (Math.max(...cells.map(c => c.x + c.width)) - m.left) * (Math.max(...cells.map(c => c.y + c.height)) - m.top), 0);
  plans.sort((a, b) => a.pages.length - b.pages.length || footprint(a) - footprint(b));
  return { plans: plans.slice(0, 4), error: null, unfit: [] };
}

export function layoutHandoff(plan: LayoutPlan, settings: PlannerSettings, unit: 'in' | 'mm'): string {
  const { paper, margins: m, gap } = settings;
  const f = (n: number) => measure(n, unit, 6);
  return [
    'Gatherframe · Print layout reference',
    `Paper: ${paper.label} — ${f(paper.width)} × ${f(paper.height)} ${unit}`,
    `Margins (${unit}): top ${f(m.top)}, right ${f(m.right)}, bottom ${f(m.bottom)}, left ${f(m.left)}`,
    `Minimum cutting gap: ${f(gap)} ${unit}; white spacing, not bleed.`,
    'Positions are measured from the top-left of the physical sheet. Width/height are the placed cell dimensions.',
    'Finished sizes are unchanged. Rotation turns the cell, not the print size.',
    'Recreate in Lightroom Classic → Print → Custom Package. Set exact paper and cell sizes; check driver margins and borderless expansion. Save as a User Template.',
    'This is a manual reference, not an importable Lightroom template or a production print file. Confirm final crops, scale and a physical test print.',
    '', 'Sheet\tPrint\tX\tY\tWidth\tHeight\tRotation',
    ...plan.pages.flatMap((page, i) => page.map(c => [i + 1, c.label, f(c.x), f(c.y), f(c.width), f(c.height), c.rotated ? '90°' : '0°'].join('\t')))
  ].join('\n');
}
