import type { Catalog } from './catalog';

/** What the browser sends: the parent's cart. Photo ids may be null while the parent is still filling cells. */
export interface CartCell { cellIndex: number; photoId: number | null; sizeChoice?: string | null; rotated?: boolean; }
export interface CartSheet { templateCode: string; cells: CartCell[]; }
export interface CartItem { key: string; productId: number; quantity: number; sheets: CartSheet[]; }

export interface PricedItem {
  key: string;
  productId: number;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  complete: boolean;
  problems: string[];
}
export interface PricedCart { items: PricedItem[]; subtotalCents: number; totalCents: number; currency: string; complete: boolean; }

/**
 * The single price authority. Imported by the client for live totals and by the server for the quote and the order.
 * `overrides` are per-event price overrides (product id -> cents).
 */
export function priceCart(cart: CartItem[], catalog: Catalog, overrides: Record<number, number> = {}): PricedCart {
  const items: PricedItem[] = [];
  const keyCounts = new Map<string, number>();
  for (const item of cart) keyCounts.set(item.key, (keyCounts.get(item.key) ?? 0) + 1);
  for (const item of cart) {
    const product = catalog.products.find((p) => p.id === item.productId);
    const problems: string[] = [];
    if (!item.key || keyCounts.get(item.key) !== 1) problems.push('Each selection needs its own reference');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) problems.push('Choose a quantity from 1 to 50');
    if (!product) {
      items.push({ key: item.key, productId: item.productId, productCode: '?', productName: 'Unknown product', quantity: item.quantity, unitPriceCents: 0, totalCents: 0, complete: false, problems: ['Product no longer available'] });
      continue;
    }
    if (!product.active) problems.push('Product no longer available');
    const qty = Math.max(1, Math.min(50, Math.floor(item.quantity || 1)));
    // Validate sheet structure matches the product definition.
    const expected = product.sheets.map((s) => s.templateCode);
    const given = item.sheets.map((s) => s.templateCode);
    if (expected.length !== given.length || expected.some((c, i) => c !== given[i])) problems.push('Print layout does not match this product');
    let filled = true;
    item.sheets.forEach((sheet) => {
      const tpl = catalog.sheets[sheet.templateCode];
      if (!tpl) { problems.push(`This print option is no longer available`); return; }
      if (sheet.cells.length !== tpl.cells.length) problems.push('Print count does not match this product');
      const indices = new Set(sheet.cells.map((c) => c.cellIndex));
      if (indices.size !== sheet.cells.length || tpl.cells.some((c) => !indices.has(c.cellIndex))) problems.push('Choose one photo for each print');
      for (const c of sheet.cells) {
        if (c.photoId == null) filled = false;
        if (c.photoId !== null && (!Number.isInteger(c.photoId) || c.photoId <= 0)) problems.push('Choose an available photo');
        const tplCell = tpl.cells.find((cell) => cell.cellIndex === c.cellIndex);
        if (!tplCell || !Number.isInteger(c.cellIndex)) { problems.push('This print position is not available'); continue; }
        if (!tplCell.sizeOptions?.length && c.sizeChoice && c.sizeChoice !== tplCell.printSizeCode) problems.push('That size is not available for this print');
        if (tplCell?.sizeOptions?.length && (!c.sizeChoice || !tplCell.sizeOptions.includes(c.sizeChoice))) problems.push('Choose a size for the display print');
      }
    });
    if (!product.allowMultiPose && new Set(item.sheets.flatMap((s) => s.cells.map((c) => c.photoId).filter((id) => id !== null))).size > 1) problems.push('Use one photo for this product');
    if (!filled) problems.push('Pick a photo for every print');
    const unit = overrides[product.id] ?? product.priceCents;
    items.push({
      key: item.key, productId: product.id, productCode: product.code, productName: product.name,
      quantity: qty, unitPriceCents: unit, totalCents: unit * qty, complete: problems.length === 0, problems
    });
  }
  const subtotal = items.reduce((n, i) => n + i.totalCents, 0);
  return { items, subtotalCents: subtotal, totalCents: subtotal, currency: catalog.currency, complete: items.length > 0 && items.every((i) => i.complete) };
}
