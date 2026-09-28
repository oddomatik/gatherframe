import type { Catalog, Product, SheetCell } from './catalog';

/** One print the parent chooses a photo for. Maps 1:1 to a sheet cell but never exposes paper geometry. */
export interface PrintSlot {
  sheetIdx: number;
  cellIndex: number;
  sizeCode: string;
  sizeOptions?: string[] | null;
  sizeChoice?: string | null;
  photoId: number | null;
}
export interface PrintGroup { key: string; label: string; count: number; prints: PrintSlot[]; }

const AREA_FALLBACK: Record<string, number> = { mini_wallet: 6, wallet: 8.75 };

export function displaySizeLabel(code: string, catalog?: Pick<Catalog, 'printSizes'>): string {
  if (code === 'wallet') return 'Wallets';
  if (code === 'mini_wallet') return 'Mini wallets';
  const s = catalog?.printSizes.find((x) => x.code === code);
  return s ? s.label.replace(/^wallet |^mini wallet /, '') : code;
}

function area(code: string, catalog?: Pick<Catalog, 'printSizes'>): number {
  const s = catalog?.printSizes.find((x) => x.code === code);
  if (s) return s.widthIn * s.heightIn;
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(code);
  return m ? Number(m[1]) * Number(m[2]) : AREA_FALLBACK[code] ?? 0;
}

/** Flatten a cart item's cells into print slots using the product's sheet templates. */
export function slotsForItem(item: { sheets: { templateCode: string; cells: { cellIndex: number; photoId: number | null; sizeChoice?: string | null }[] }[] }, catalog: Catalog): PrintSlot[] {
  const out: PrintSlot[] = [];
  item.sheets.forEach((sheet, sheetIdx) => {
    const tpl = catalog.sheets[sheet.templateCode];
    for (const c of sheet.cells) {
      const tplCell: SheetCell | undefined = tpl?.cells[c.cellIndex];
      out.push({ sheetIdx, cellIndex: c.cellIndex, sizeCode: tplCell?.printSizeCode ?? '?', sizeOptions: tplCell?.sizeOptions ?? null, sizeChoice: c.sizeChoice ?? null, photoId: c.photoId });
    }
  });
  return out;
}

/** Group prints by size (largest first) for display: "8x10 · 1 print", "Wallets · 4 prints". */
export function groupPrints(slots: PrintSlot[], catalog?: Pick<Catalog, 'printSizes'>): PrintGroup[] {
  const groups = new Map<string, PrintGroup>();
  for (const s of slots) {
    const code = s.sizeOptions?.length ? 'display' : s.sizeCode;
    const label = s.sizeOptions?.length ? `Display print (${s.sizeChoice ?? s.sizeOptions.join(' or ')})` : displaySizeLabel(s.sizeCode, catalog);
    const g = groups.get(code) ?? { key: code, label, count: 0, prints: [] };
    g.label = label; g.count++; g.prints.push(s);
    groups.set(code, g);
  }
  return [...groups.values()].sort((a, b) => {
    const aa = a.key === 'display' ? 1e6 : area(a.key, catalog), ba = b.key === 'display' ? 1e6 : area(b.key, catalog);
    return ba - aa;
  });
}

export function printCount(product: Product, catalog: Catalog): number {
  return product.sheets.reduce((n, ps) => n + (catalog.sheets[ps.templateCode]?.cells.length ?? 0), 0);
}
