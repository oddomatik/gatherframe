import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog';
import { priceCart } from './pricing';

const catalog: Catalog = {
  currency: 'USD',
  printSizes: [{ code: '8x10', label: '8x10', widthIn: 8, heightIn: 10 }, { code: 'wallet', label: 'wallet', widthIn: 2.5, heightIn: 3.5 }],
  sheets: {
    s1: { code: 's1', label: '8x10', paperWidthIn: 8, paperHeightIn: 10, cells: [{ cellIndex: 0, printSizeCode: '8x10', label: '8x10', xIn: 0, yIn: 0, wIn: 8, hIn: 10, rotation: 0 }] },
    disp: { code: 'disp', label: 'Display', paperWidthIn: 13, paperHeightIn: 19, cells: [{ cellIndex: 0, printSizeCode: '11x14', label: 'Display', xIn: 1, yIn: 2.5, wIn: 11, hIn: 14, rotation: 0, sizeOptions: ['11x14', '12x18'] }] }
  },
  products: [
    { id: 1, code: 'std', kind: 'package', name: 'Standard', priceCents: 2000, allowMultiPose: true, active: true, sortOrder: 1, sheets: [{ templateCode: 's1' }] },
    { id: 2, code: 'disp', kind: 'single', name: 'Display', priceCents: 2000, allowMultiPose: false, active: true, sortOrder: 2, sheets: [{ templateCode: 'disp' }] },
    { id: 3, code: 'gone', kind: 'single', name: 'Gone', priceCents: 100, allowMultiPose: false, active: false, sortOrder: 3, sheets: [{ templateCode: 's1' }] }
  ]
};

describe('priceCart', () => {
  it('prices a complete item and applies quantity', () => {
    const r = priceCart([{ key: 'a', productId: 1, quantity: 2, sheets: [{ templateCode: 's1', cells: [{ cellIndex: 0, photoId: 7 }] }] }], catalog);
    expect(r.totalCents).toBe(4000);
    expect(r.complete).toBe(true);
  });
  it('flags unfilled cells and wrong sheets', () => {
    const r = priceCart([{ key: 'a', productId: 1, quantity: 1, sheets: [{ templateCode: 's1', cells: [{ cellIndex: 0, photoId: null }] }] }], catalog);
    expect(r.complete).toBe(false);
    expect(r.items[0].problems).toContain('Pick a photo for every print');
    const bad = priceCart([{ key: 'b', productId: 1, quantity: 1, sheets: [{ templateCode: 'disp', cells: [{ cellIndex: 0, photoId: 1 }] }] }], catalog);
    expect(bad.items[0].problems.join()).toMatch(/layout/);
  });
  it('requires a size choice on display cells', () => {
    const r = priceCart([{ key: 'a', productId: 2, quantity: 1, sheets: [{ templateCode: 'disp', cells: [{ cellIndex: 0, photoId: 7 }] }] }], catalog);
    expect(r.complete).toBe(false);
    const ok = priceCart([{ key: 'a', productId: 2, quantity: 1, sheets: [{ templateCode: 'disp', cells: [{ cellIndex: 0, photoId: 7, sizeChoice: '12x18' }] }] }], catalog);
    expect(ok.complete).toBe(true);
  });
  it('applies event overrides and rejects inactive/unknown products', () => {
    const r = priceCart([{ key: 'a', productId: 1, quantity: 1, sheets: [{ templateCode: 's1', cells: [{ cellIndex: 0, photoId: 7 }] }] }], catalog, { 1: 1500 });
    expect(r.totalCents).toBe(1500);
    const gone = priceCart([{ key: 'a', productId: 3, quantity: 1, sheets: [{ templateCode: 's1', cells: [{ cellIndex: 0, photoId: 7 }] }] }], catalog);
    expect(gone.complete).toBe(false);
    const unknown = priceCart([{ key: 'a', productId: 99, quantity: 1, sheets: [] }], catalog);
    expect(unknown.items[0].problems[0]).toMatch(/no longer/);
  });
});
