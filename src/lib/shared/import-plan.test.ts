import { describe, expect, it } from 'vitest';
import { findImportMatches, planImportFiles, sameImportBytes, sourceFolder, type ImportPhoto } from './import-plan';

describe('Lightroom import planning', () => {
  it('recognizes a 180-photo export parent even through a single-version picker', () => {
    const files = Array.from({ length: 180 }, (_, i) => {
      const stem = `MtnKidsPicDay-${String(i + 1).padStart(3, '0')}`;
      return [['full', 'jpg'], ['social', 'jpg'], ['raw', 'CR3'], ['raw', 'xmp']].map(([folder, ext]) => ({
        name: `${stem}.${ext}`, webkitRelativePath: `MtnKidsPicDay/${folder}/${stem}.${ext}`
      }));
    }).flat();
    for (const picker of [null, 'print', 'social', 'raw'] as const) {
      const plan = planImportFiles(files, picker);
      expect(plan.size).toBe(180);
      for (const row of plan.values()) expect(row.map((f) => f.role)).toEqual(['print', 'social', 'raw', 'xmp']);
    }
    expect(sourceFolder('Export/ SOCIAL /IMG_001.jpg').role).toBe('social');
  });

  it('compares repeated selections by bytes, including matching metadata with different contents', async () => {
    const first = new File(['1234'], 'photo.jpg', { lastModified: 123 });
    const repeated = new File(['1234'], 'photo.jpg', { lastModified: 123 });
    const changed = new File(['4321'], 'photo.jpg', { lastModified: 123 });
    expect(first).not.toBe(repeated);
    expect(await sameImportBytes(first, repeated)).toBe(true);
    expect(await sameImportBytes(first, changed)).toBe(false);
    expect(await sameImportBytes(first, new Blob(['12345']))).toBe(false);
    const large = new Uint8Array(2 * 1024 * 1024 + 1);
    const copy = new Blob([large]); large[large.length - 1] = 1;
    expect(await sameImportBytes(copy, new Blob([large]))).toBe(false);
    expect(await sameImportBytes(copy, new Blob([new Uint8Array(large.length)]))).toBe(true);
  });

  it('pairs versions identically when selecting the common parent or separate version folders', () => {
    const fromParent = planImportFiles([
      { name: 'IMG_0412.jpg', webkitRelativePath: 'Gatherframe/full/IMG_0412.jpg' },
      { name: 'IMG_0412.jpg', webkitRelativePath: 'Gatherframe/social/IMG_0412.jpg' },
      { name: 'IMG_0412.CR3', webkitRelativePath: 'Gatherframe/raw/IMG_0412.CR3' }
    ]);
    const separate = planImportFiles([
      { name: 'IMG_0412.jpg', webkitRelativePath: 'full/IMG_0412.jpg' },
      { name: 'IMG_0412.jpg', webkitRelativePath: 'social/IMG_0412.jpg' },
      { name: 'IMG_0412.CR3', webkitRelativePath: 'raw/IMG_0412.CR3' }
    ]);
    expect([...fromParent.keys()]).toEqual(['img_0412']);
    expect([...separate.keys()]).toEqual([...fromParent.keys()]);
    expect(fromParent.get('img_0412')!.map((f) => f.role)).toEqual(['print', 'social', 'raw']);
    expect(separate.get('img_0412')!.map((f) => f.role)).toEqual(['print', 'social', 'raw']);
  });

  it('pairs unequal folders by basename, never by selection order or missing versions', () => {
    const rows = planImportFiles([
      { name: 'IMG_0413.jpg', webkitRelativePath: 'full/IMG_0413.jpg' },
      { name: 'IMG_0412.jpg', webkitRelativePath: 'social/IMG_0412.jpg' },
      { name: 'IMG_0412.jpg', webkitRelativePath: 'full/IMG_0412.jpg' },
      { name: 'IMG_0414.jpg', webkitRelativePath: 'social/IMG_0414.jpg' }
    ]);
    expect(rows.size).toBe(3);
    expect(rows.get('img_0412')!.map((f) => f.role)).toEqual(['social', 'print']);
    expect(rows.get('img_0413')!.map((f) => f.role)).toEqual(['print']);
    expect(rows.get('img_0414')!.map((f) => f.role)).toEqual(['social']);
  });

  it('uses explicit folder purpose without changing identity, including unusual folder names', () => {
    const files = [{ name: 'IMG_0412.JPG', webkitRelativePath: 'For Instagram/IMG_0412.JPG' }];
    expect(planImportFiles(files, 'social').get('img_0412')![0].role).toBe('social');
    expect(planImportFiles(files, 'print').get('img_0412')![0].role).toBe('print');
    expect(planImportFiles([{ name: 'IMG_0412.CR3' }], 'print').get('img_0412')![0].role).toBe('raw');
    expect(sourceFolder('exports/Full Resolution/child one/IMG_0412.jpg').role).toBe('print');
  });

  it('retains intentional edit suffixes and all duplicate slot candidates', () => {
    const rows = planImportFiles([
      { name: 'IMG_0412.jpg', webkitRelativePath: 'first/full/IMG_0412.jpg' },
      { name: 'IMG_0412.jpg', webkitRelativePath: 'second/full/IMG_0412.jpg' },
      { name: 'IMG_0412-Edit.jpg' }, { name: 'IMG_0412-2.jpg' }
    ]);
    expect([...rows.keys()]).toEqual(['img_0412', 'img_0412-edit', 'img_0412-2']);
    expect(rows.get('img_0412')).toHaveLength(2);
  });

  it('links RAW and Lightroom sidecars in separate slots, independent of folder purpose', () => {
    const files = [
      { name: 'IMG_0412.CR3', webkitRelativePath: 'Gatherframe/raw/IMG_0412.CR3' },
      { name: 'IMG_0412.xmp', webkitRelativePath: 'Gatherframe/raw/IMG_0412.xmp' },
      { name: 'IMG_0412.ACR', webkitRelativePath: 'Gatherframe/raw/IMG_0412.ACR' }
    ];
    expect(planImportFiles(files).get('img_0412')!.map((f) => f.role)).toEqual(['raw', 'xmp', 'acr']);
    // Explicit image zones must not turn edit instructions into downloadable images.
    expect(planImportFiles(files, 'print').get('img_0412')!.map((f) => f.role)).toEqual(['raw', 'xmp', 'acr']);
    expect(planImportFiles(files, 'raw').get('img_0412')!.map((f) => f.role)).toEqual(['raw', 'xmp', 'acr']);
  });

  it('keeps unequal sidecar sets and duplicate sidecars visible without shifting image matches', () => {
    const rows = planImportFiles([
      { name: 'IMG_0413.xmp', webkitRelativePath: 'raw/IMG_0413.xmp' },
      { name: 'IMG_0412.CR3', webkitRelativePath: 'raw/IMG_0412.CR3' },
      { name: 'IMG_0412.xmp', webkitRelativePath: 'raw/IMG_0412.xmp' },
      { name: 'IMG_0412.xmp', webkitRelativePath: 'other/IMG_0412.xmp' },
      { name: 'IMG_0414.acr', webkitRelativePath: 'raw/IMG_0414.acr' }
    ]);
    expect(rows.get('img_0412')!.map((f) => f.role)).toEqual(['raw', 'xmp', 'xmp']);
    expect(rows.get('img_0413')!.map((f) => f.role)).toEqual(['xmp']);
    expect(rows.get('img_0414')!.map((f) => f.role)).toEqual(['acr']);
  });

  const photos: ImportPhoto[] = [
    { id: 1, stem: 'legacy~folder-hash', matchKeys: ['img_0412'], files: [{ role: 'print', originalFilename: 'IMG_0412.jpg' }], collections: [{ id: 9, name: 'Friends', isIntake: 0, isArchived: 0 }] },
    { id: 2, stem: 'img_0413', matchKeys: ['img_0413'], files: [], collections: [{ id: 10, name: 'Archived', isIntake: 0, isArchived: 1 }] }
  ];
  it('finds existing photos across collections and legacy folder-based stems', () => {
    expect(findImportMatches(photos, 'img_0412').map((p) => p.id)).toEqual([1]);
    expect(findImportMatches(photos, 'img_0413').map((p) => p.id)).toEqual([2]);
    expect(findImportMatches(photos, 'img_9999')).toEqual([]);
  });
  it('exposes ambiguity instead of silently choosing a photo, and honors intentional separation', () => {
    const ambiguous = [...photos, { ...photos[0], id: 3, stem: 'img_0412~separate' }];
    expect(findImportMatches(ambiguous, 'img_0412')).toHaveLength(2);
    expect(findImportMatches(ambiguous, 'img_0412', 'img_0412~separate').map((p) => p.id)).toEqual([3]);
    expect(findImportMatches(ambiguous, 'img_0412', 'img_0412~new')).toEqual([]);
  });
});
