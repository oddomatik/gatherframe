import { describe, expect, it } from 'vitest';
import { cropLossExceeds, fitPhotoToCell } from './geometry';

describe('rotation-aware print fit', () => {
  it('fits portrait and landscape 4x6 without cropping, in either sheet orientation', () => {
    expect(fitPhotoToCell(6000, 4000, 4, 6)).toEqual({ rotation: 90, cropLoss: 0 });
    expect(fitPhotoToCell(4000, 6000, 4, 6)).toEqual({ rotation: 0, cropLoss: 0 });
    expect(fitPhotoToCell(4000, 6000, 6, 4)).toEqual({ rotation: 90, cropLoss: 0 });
    expect(fitPhotoToCell(6000, 4000, 6, 4)).toEqual({ rotation: 0, cropLoss: 0 });
    expect(cropLossExceeds(6000, 4000, 4, 6)).toBe(false);
  });
  it('does not confuse modest 5x7 trimming with an orientation mismatch', () => {
    expect(fitPhotoToCell(6000, 4000, 5, 7)?.rotation).toBe(90);
    expect(fitPhotoToCell(6000, 4000, 5, 7)?.cropLoss).toBeCloseTo(1 - 14 / 15);
    expect(cropLossExceeds(6000, 4000, 5, 7)).toBe(false);
  });
  it('still flags genuine panoramic and square-format cropping after rotation', () => {
    expect(cropLossExceeds(8000, 2000, 4, 6)).toBe(true);
    expect(cropLossExceeds(2000, 8000, 6, 4)).toBe(true);
    expect(cropLossExceeds(6000, 4000, 5, 5)).toBe(true);
  });
  it('leaves equal-fit orientations upright and respects the strict crop threshold', () => {
    expect(fitPhotoToCell(3000, 3000, 4, 5)?.rotation).toBe(0);
    expect(fitPhotoToCell(6000, 4000, 5, 5)?.rotation).toBe(0);
    expect(cropLossExceeds(3000, 3000, 4, 5)).toBe(false);
    expect(cropLossExceeds(3000, 3000, 4, 5.1)).toBe(true);
    expect(cropLossExceeds(6000, 4000, 5, 7, 0.05)).toBe(true);
  });
  it('does not invent a crop estimate for missing or invalid dimensions', () => {
    for (const n of [0, -1, NaN, Infinity]) {
      expect(fitPhotoToCell(n, 4000, 4, 6)).toBeNull();
      expect(fitPhotoToCell(6000, 4000, 4, n)).toBeNull();
      expect(cropLossExceeds(n, 4000, 4, 6)).toBe(false);
    }
  });
});
