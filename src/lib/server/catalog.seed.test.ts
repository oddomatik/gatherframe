import { describe, expect, it } from 'vitest';
import { validateSheet } from '$shared/geometry';
import { SEED_PRODUCTS, SEED_SHEETS, SEED_PRINT_SIZES } from './catalog.seed';

describe('catalog seed geometry', () => {
  it('every sheet fits its paper with no overlapping cells', () => {
    for (const sheet of SEED_SHEETS) expect(validateSheet(sheet)).toEqual([]);
  });
  it('every cell references a known print size and matches its dimensions (allowing rotation)', () => {
    const sizes = new Map(SEED_PRINT_SIZES.map((s) => [s.code, s]));
    for (const sheet of SEED_SHEETS) for (const c of sheet.cells) {
      const s = sizes.get(c.printSizeCode);
      expect(s, `${sheet.code} cell ${c.cellIndex}`).toBeTruthy();
      const upright = c.wIn === s!.widthIn && c.hIn === s!.heightIn;
      const rotated = c.wIn === s!.heightIn && c.hIn === s!.widthIn;
      expect(upright || rotated, `${sheet.code} cell ${c.cellIndex} dims`).toBe(true);
      if (rotated && !upright) expect(c.rotation).toBe(90);
    }
  });
  it('every product references existing sheets', () => {
    const codes = new Set(SEED_SHEETS.map((s) => s.code));
    for (const p of SEED_PRODUCTS) for (const s of p.sheets) expect(codes.has(s), `${p.code} -> ${s}`).toBe(true);
  });
  it('the Deluxe composite holds exactly 1 8x10, 2 5x7 and 4 wallets', () => {
    const deluxe = SEED_SHEETS.find((s) => s.code === '13x19_composite')!;
    const count = (code: string) => deluxe.cells.filter((c) => c.printSizeCode === code).length;
    expect([count('8x10'), count('5x7'), count('wallet')]).toEqual([1, 2, 4]);
  });
});
