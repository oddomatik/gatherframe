/** Catalog shapes shared by server (DB rows mapped to these) and client (builder). */
export interface PrintSize { code: string; label: string; widthIn: number; heightIn: number; }

export interface SheetCell {
  cellIndex: number;
  printSizeCode: string;
  label: string;
  xIn: number; yIn: number; wIn: number; hIn: number;
  /** 90 when the print is placed rotated on the sheet (landscape cell for a portrait size). */
  rotation: 0 | 90;
  cellGroup?: string | null;
  /** When set, the parent chooses one of these sizes for the cell (e.g. Display add-on 11x14 or 12x18). */
  sizeOptions?: string[] | null;
}

export interface SheetTemplate {
  code: string;
  label: string;
  paperWidthIn: number;
  paperHeightIn: number;
  cells: SheetCell[];
}

export interface Product {
  id: number;
  code: string;
  kind: 'package' | 'single';
  name: string;
  description?: string | null;
  priceCents: number;
  allowMultiPose: boolean;
  active: boolean;
  sortOrder: number;
  sheets: { templateCode: string; label?: string | null }[];
}

export interface Catalog {
  currency: string;
  printSizes: PrintSize[];
  sheets: Record<string, SheetTemplate>;
  products: Product[];
}

/** Human summary like "1 8x10 · 2 5x7 · 4 wallets". */
export function contentsSummary(product: Product, catalog: Catalog): string {
  const counts = new Map<string, number>();
  for (const ps of product.sheets) {
    const sheet = catalog.sheets[ps.templateCode];
    if (!sheet) continue;
    for (const c of sheet.cells) {
      const key = c.sizeOptions?.length ? c.sizeOptions.join(' or ') : c.printSizeCode;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([key, n]) => `${n} ${friendlySize(key, n)}`).join(' · ');
}

/** "wallet" -> "wallets", "mini_wallet" -> "mini wallets", "8x10" stays; size-option keys pass through. */
export function friendlySize(code: string, n = 1): string {
  if (code === 'wallet') return n === 1 ? 'wallet' : 'wallets';
  if (code === 'mini_wallet') return n === 1 ? 'mini wallet' : 'mini wallets';
  return code;
}

export function sizeLabel(code: string, catalog: Catalog): string {
  return catalog.printSizes.find((s) => s.code === code)?.label ?? code;
}

export function cellCount(product: Product, catalog: Catalog): number {
  return product.sheets.reduce((n, ps) => n + (catalog.sheets[ps.templateCode]?.cells.length ?? 0), 0);
}
