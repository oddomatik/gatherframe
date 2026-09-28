import { normalizeStem, splitExtension, type VariantRole } from './stem';

/** Lightroom v1: a filename within an event identifies a photo, not its folder or collection.
 * Keep meaningful suffixes (including numbers and edit names); only the extension is removed. */
export function photoKey(filename: string): string {
  return splitExtension(filename).base.normalize('NFC').toLowerCase().trim();
}

/** Recover existing folder-based imports without changing photo IDs or rewriting history.
 * Deliberate Keep-separate names only match their chosen key, never the original's filename. */
export function photoMatchKeys(
  photo: { stem: string; files: { originalFilename: string }[] },
  patterns?: Record<string, VariantRole>
): string[] {
  const stem = photo.stem.normalize('NFC').toLowerCase().trim();
  const aliases = photo.files.filter((file) =>
    /~folder-[a-z0-9]+$/.test(stem) || photoKey(file.originalFilename) === stem || normalizeStem(file.originalFilename, patterns).stem === stem
  ).map((file) => photoKey(file.originalFilename));
  return [...new Set([stem, ...aliases])];
}
