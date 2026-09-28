import { describe, expect, it } from 'vitest';
import { compareShotNames } from './photo-order';

describe('shot-number ordering', () => {
  it('orders padded and unpadded Lightroom filenames numerically without changing them', () => {
    const names = ['MtnKidsPicDay-110', 'MtnKidsPicDay-10', 'MtnKidsPicDay-2', 'MtnKidsPicDay-009', 'MtnKidsPicDay-104'];
    expect([...names].sort(compareShotNames)).toEqual(['MtnKidsPicDay-2', 'MtnKidsPicDay-009', 'MtnKidsPicDay-10', 'MtnKidsPicDay-104', 'MtnKidsPicDay-110']);
    expect(names[0]).toBe('MtnKidsPicDay-110');
  });
  it('has deterministic ties and retains alternate edits as distinct filenames', () => {
    const names = ['IMG_10', 'img_2-edit', 'img_2', 'img_02', 'portrait'];
    expect([...names].sort(compareShotNames)).toEqual(['img_02', 'img_2', 'img_2-edit', 'IMG_10', 'portrait']);
    expect([...names].reverse().sort(compareShotNames)).toEqual([...names].sort(compareShotNames));
  });
});
