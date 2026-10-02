/** Numeric-aware filename order, independent of upload/preview completion or IDs.
 * Never rename photos or infer child identity from this presentation order. */
const filenames = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function compareShotNames(a: string, b: string): number {
  const left = a.normalize('NFC').toLowerCase(), right = b.normalize('NFC').toLowerCase();
  return filenames.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}
export function comparePhotoOrder(a: { stem: string; id: number; sortOrder: number; collectionPosition?: number | null }, b: { stem: string; id: number; sortOrder: number; collectionPosition?: number | null }): number {
  const left = a.collectionPosition ?? Infinity, right = b.collectionPosition ?? Infinity;
  if (left !== right) return left < right ? -1 : 1;
  return a.sortOrder - b.sortOrder || compareShotNames(a.stem, b.stem) || a.id - b.id;
}
