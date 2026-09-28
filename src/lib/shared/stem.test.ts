import { describe, expect, it } from 'vitest';
import { groupByStem, inferRole, normalizeStem } from './stem';

describe('normalizeStem', () => {
  it('pairs Lightroom exports with role suffixes', () => {
    expect(normalizeStem('IMG_0412-social.jpg').stem).toBe('img_0412');
    expect(normalizeStem('IMG_0412-print.jpg').stem).toBe('img_0412');
    expect(normalizeStem('IMG_0412.CR3').stem).toBe('img_0412');
    expect(normalizeStem('IMG_0412-social.jpg').roleHint).toBe('social');
    expect(normalizeStem('IMG_0412.CR3').roleHint).toBe('raw');
  });
  it('strips Lightroom duplicate counters and -Edit', () => {
    expect(normalizeStem('IMG_0412-Edit-2.jpg').stem).toBe('img_0412');
    expect(normalizeStem('IMG_0412-Edit.jpg').stem).toBe('img_0412');
  });
  it('does not eat purely numeric stems', () => {
    expect(normalizeStem('0412.jpg').stem).toBe('0412');
    expect(normalizeStem('DSC-2.jpg').stem).toBe('dsc');
  });
  it('unicode normalizes so NFD and NFC pair', () => {
    const nfd = 'José-001-print.jpg';
    const nfc = 'José-001-social.jpg';
    expect(normalizeStem(nfd).stem).toBe(normalizeStem(nfc).stem);
  });
  it('is case insensitive', () => {
    expect(normalizeStem('Emma_Smile-PRINT.JPG').stem).toBe('emma_smile');
  });
});

describe('inferRole', () => {
  it('zone wins over everything', () => {
    expect(inferRole({ filename: 'a-print.jpg', zoneRole: 'social' })).toBe('social');
  });
  it('extension marks raw', () => {
    expect(inferRole({ filename: 'a.NEF' })).toBe('raw');
  });
  it('uses size when no suffix', () => {
    expect(inferRole({ filename: 'a.jpg', longEdgePx: 2048 })).toBe('social');
    expect(inferRole({ filename: 'a.jpg', longEdgePx: 6000 })).toBe('print');
    expect(inferRole({ filename: 'a.jpg' })).toBe('print');
  });
});

describe('groupByStem', () => {
  it('builds a matrix row per stem', () => {
    const m = groupByStem([{ name: 'A-social.jpg' }, { name: 'A-print.jpg' }, { name: 'A.CR2' }, { name: 'B-social.jpg' }]);
    expect(m.get('a')).toEqual({ social: 'A-social.jpg', print: 'A-print.jpg', raw: 'A.CR2' });
    expect(m.get('b')).toEqual({ social: 'B-social.jpg' });
  });
});
