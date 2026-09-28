import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog';
import { groupPrints, slotsForItem } from './prints';

const catalog: Catalog = {
  currency: 'USD',
  printSizes: [{ code: '8x10', label: '8x10', widthIn: 8, heightIn: 10 }, { code: '5x7', label: '5x7', widthIn: 5, heightIn: 7 }, { code: 'wallet', label: 'wallet 2.5x3.5', widthIn: 2.5, heightIn: 3.5 }],
  sheets: {
    composite: { code: 'composite', label: '13x19', paperWidthIn: 13, paperHeightIn: 19, cells: [
      { cellIndex: 0, printSizeCode: '8x10', label: '8x10', xIn: 0, yIn: 0, wIn: 8, hIn: 10, rotation: 0 },
      { cellIndex: 1, printSizeCode: '5x7', label: '5x7', xIn: 8, yIn: 0, wIn: 5, hIn: 7, rotation: 0 },
      { cellIndex: 2, printSizeCode: 'wallet', label: 'wallet', xIn: 0, yIn: 14, wIn: 2.5, hIn: 3.5, rotation: 0 },
      { cellIndex: 3, printSizeCode: 'wallet', label: 'wallet', xIn: 2.5, yIn: 14, wIn: 2.5, hIn: 3.5, rotation: 0 }
    ] }
  },
  products: []
};

describe('parent print view', () => {
  it('flattens cells to print slots and groups them by size, largest first, without any paper geometry', () => {
    const slots = slotsForItem({ sheets: [{ templateCode: 'composite', cells: [{ cellIndex: 0, photoId: 1 }, { cellIndex: 1, photoId: null }, { cellIndex: 2, photoId: 2 }, { cellIndex: 3, photoId: 2 }] }] }, catalog);
    expect(slots).toHaveLength(4);
    expect(Object.keys(slots[0])).not.toContain('xIn');
    const groups = groupPrints(slots, catalog);
    expect(groups.map((g) => [g.label, g.count])).toEqual([['8x10', 1], ['5x7', 1], ['Wallets', 2]]);
  });
  it('keeps largest-first order even without catalog dimensions (order confirmation page)', () => {
    const groups = groupPrints([
      { sheetIdx: 0, cellIndex: 2, sizeCode: 'wallet', photoId: 1 }, { sheetIdx: 0, cellIndex: 0, sizeCode: '8x10', photoId: 1 },
      { sheetIdx: 0, cellIndex: 1, sizeCode: '5x7', photoId: 1 }, { sheetIdx: 1, cellIndex: 0, sizeCode: '11x14', sizeOptions: ['11x14', '12x18'], sizeChoice: '12x18', photoId: 1 }
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Display print (12x18)', '8x10', '5x7', 'Wallets']);
  });
});
