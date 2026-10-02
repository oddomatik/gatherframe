import { describe, expect, it } from 'vitest';
import { INCH, PAPERS, defaultMargins, planPrints, productCounts, templateCounts, layoutHandoff } from './print-planner';
import type { PlannerSettings, LayoutPlan } from './print-planner';
import { SEED_PRINT_SIZES, SEED_SHEETS } from '../server/catalog.seed';
import type { Catalog, Product } from './catalog';

const zero = { top: 0, right: 0, bottom: 0, left: 0 };
const settings = (): PlannerSettings => ({ paper: PAPERS.find(p => p.code === 'a3plus')!, margins: defaultMargins(), gap: INCH / 8, rotate: true });
const deluxe = { '8x10': 1, '5x7': 2, wallet: 4 };

// Independent acceptance invariants: every requested rectangle survives with exact size,
// inside the usable paper, and separated from every other rectangle by the requested gap.
function verify(plan: LayoutPlan, counts: Record<string, number>, s: PlannerSettings) {
  const seen: Record<string, number> = {};
  const ids = new Set<string>();
  for (const page of plan.pages) {
    for (const p of page) {
      expect(ids.has(p.id)).toBe(false); ids.add(p.id);
      seen[p.code] = (seen[p.code] ?? 0) + 1;
      const size = SEED_PRINT_SIZES.find(x => x.code === p.code)!;
      expect([p.width, p.height]).toEqual(p.rotated ? [size.heightIn * INCH, size.widthIn * INCH] : [size.widthIn * INCH, size.heightIn * INCH]);
      if (!s.rotate) expect(p.rotated).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(s.margins.left);
      expect(p.y).toBeGreaterThanOrEqual(s.margins.top);
      expect(p.x + p.width).toBeLessThanOrEqual(s.paper.width - s.margins.right);
      expect(p.y + p.height).toBeLessThanOrEqual(s.paper.height - s.margins.bottom);
    }
    for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) {
      const a = page[i], b = page[j], g = s.gap;
      expect(a.x + a.width + g <= b.x || b.x + b.width + g <= a.x || a.y + a.height + g <= b.y || b.y + b.height + g <= a.y).toBe(true);
    }
  }
  expect(seen).toEqual(Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)));
  expect(plan.utilization).toBeGreaterThan(0); expect(plan.utilization).toBeLessThanOrEqual(1);
}

describe('optional print planner', () => {
  it('fits the full deluxe mix on exact A3+ with half-inch margins and eighth-inch cutting gaps', () => {
    const s = settings(); s.margins = { top: INCH / 2, bottom: INCH / 2, left: INCH / 2, right: INCH / 2 };
    expect(s.paper.width).toBe(329000); expect(s.paper.height).toBe(483000);
    const result = planPrints(SEED_PRINT_SIZES, deluxe, s);
    expect(result.error).toBeNull(); expect(result.plans[0].pages).toHaveLength(1);
    result.plans.forEach(p => verify(p, deluxe, s));
  });
  it('does not fit an 8-inch plus 5-inch row on the rounded 13-inch assumption', () => {
    const s = settings(); s.paper = { code: 'short-a3plus', label: '329 mm wide', width: 329000, height: 10 * INCH }; s.margins = zero; s.gap = 0; s.rotate = false;
    const counts = { '8x10': 1, '5x7': 1 };
    const result = planPrints(SEED_PRINT_SIZES, counts, s);
    expect(result.plans[0].pages).toHaveLength(2); result.plans.forEach(p => verify(p, counts, s));
  });
  it('treats exact-size stock, outer margins and cutting gaps separately', () => {
    const s = { ...settings(), paper: PAPERS.find(p => p.code === '5x7')!, margins: zero, gap: 0 };
    const result = planPrints(SEED_PRINT_SIZES, { wallet: 4 }, s);
    expect(result.plans[0].pages).toHaveLength(1); verify(result.plans[0], { wallet: 4 }, s);
    expect(planPrints(SEED_PRINT_SIZES, { wallet: 4 }, { ...s, gap: INCH / 8 }).plans[0].pages.length).toBeGreaterThan(1);
    expect(planPrints(SEED_PRINT_SIZES, { '5x7': 1 }, { ...s, margins: defaultMargins() }).unfit).toEqual(['5x7']);
  });
  it('reports oversized prints without returning an incomplete package', () => {
    const result = planPrints(SEED_PRINT_SIZES, { wallet: 4, '11x14': 1 }, { ...settings(), paper: PAPERS[0] });
    expect(result.plans).toEqual([]); expect(result.unfit).toEqual(['11x14']);
  });
  it('validates empty, fractional, excessive, unknown and non-finite inputs', () => {
    const cases: Record<string, number>[] = [{}, { wallet: -1 }, { wallet: 1.5 }, { wallet: 61 }, { wallet: 40, '5x7': 30 }, { wallet: NaN }, { mystery: 1 }];
    for (const counts of cases) expect(planPrints(SEED_PRINT_SIZES, counts, settings()).plans).toEqual([]);
    for (const value of [NaN, Infinity, -1, .5]) expect(planPrints(SEED_PRINT_SIZES, deluxe, { ...settings(), gap: value }).plans).toEqual([]);
    expect(planPrints(SEED_PRINT_SIZES, deluxe, { ...settings(), margins: { ...zero, top: 483000 } }).error).toMatch(/no printable area/);
  });
  it('preserves dimensions, quantities and gaps across varied packages, orientations and asymmetric margins', () => {
    for (let n = 0; n < 20; n++) {
      const s = settings();
      if (n % 2) s.paper = { ...s.paper, width: s.paper.height, height: s.paper.width };
      s.margins = { top: 3500, right: 7000, bottom: 12000, left: 2100 }; s.gap = 1000 + n * 250; s.rotate = n % 3 !== 0;
      const counts = { '8x10': n % 3, '5x7': n % 4, wallet: n % 6, mini_wallet: 2, '4x6': n % 5 };
      const result = planPrints(SEED_PRINT_SIZES, counts, s);
      expect(result.error).toBeNull(); result.plans.forEach(p => verify(p, counts, s));
    }
    const counts = { wallet: 60 }, s = settings();
    planPrints(SEED_PRINT_SIZES, counts, s).plans.forEach(p => verify(p, counts, s));
  });
  it('imports suggestion contents without changing templates or multiplying size-choice alternatives', () => {
    const sheets = Object.fromEntries(SEED_SHEETS.map(t => [t.code, t]));
    const product = { sheets: [{ templateCode: '13x19_composite' }, { templateCode: '13x19_composite' }] } as Product;
    const before = JSON.stringify(SEED_SHEETS);
    expect(templateCounts(sheets['13x19_composite'])).toEqual(deluxe);
    expect(productCounts(product, { sheets } as Catalog)).toEqual({ '8x10': 2, '5x7': 4, wallet: 8 });
    expect(templateCounts(sheets['13x19_display'])).toEqual({ '11x14': 1 });
    expect(JSON.stringify(SEED_SHEETS)).toBe(before);
  });
  it('exports the selected placements with explicit units and manual Lightroom handoff', () => {
    const s = settings(), p = planPrints(SEED_PRINT_SIZES, deluxe, s).plans[0];
    const text = layoutHandoff(p, s, 'mm');
    expect(text).toContain('329 × 483 mm'); expect(text).toContain('not an importable Lightroom template');
    expect(text.split('\n').filter(l => l.startsWith('1\t'))).toHaveLength(7);
    expect(text).toContain('Minimum cutting gap: 3.175 mm');
  });
});
