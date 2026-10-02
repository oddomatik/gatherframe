/**
 * Filename stem normalization and role inference for photographer uploads.
 * Pure functions, shared by the browser (upload matrix) and the server (ingest).
 */
export type VariantRole = 'social' | 'print' | 'raw' | `v_${string}`;
export const VARIANT_ROLES: VariantRole[] = ['social', 'print', 'raw'];
export function isVariantRole(role: unknown): role is VariantRole {
  return typeof role === 'string' && /^(print|social|raw|v_[a-z0-9]{16})$/.test(role);
}
/** Private companions are upload roles, never parent-downloadable image variants. */
export type SidecarKind = 'xmp' | 'acr';
export type UploadRole = VariantRole | SidecarKind;
export const SIDECAR_KINDS: SidecarKind[] = ['xmp', 'acr'];
export const UPLOAD_ROLES: UploadRole[] = [...VARIANT_ROLES, ...SIDECAR_KINDS];

/** Camera RAW extensions (merged PicPeak + Lumio lists). Lowercase, no dot. */
export const RAW_EXTENSIONS = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'raf', 'rw2', 'orf', 'pef', 'ptx',
  'srw', 'raw', '3fr', 'dcr', 'kdc', 'x3f', 'fff', 'iiq', 'mef', 'mrw', 'erf'
]);
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic', 'heif', 'avif']);

/** Default suffix patterns: `suffix -> role`. Matched case-insensitively at the end of the stem, after an optional -, _ or space. */
export const DEFAULT_SUFFIX_PATTERNS: Record<string, VariantRole> = {
  social: 'social', web: 'social', sm: 'social', small: 'social', ig: 'social', insta: 'social', share: 'social',
  print: 'print', full: 'print', hi: 'print', hires: 'print', large: 'print', lg: 'print', master: 'print'
};

/** Suffixes Lightroom and editors add that carry no role meaning and should be stripped. */
const NOISE_SUFFIXES = ['edit', 'edited', 'enhanced', 'final', 'v2', 'copy'];

export interface StemResult {
  /** Normalized stem used as the photo key within a gallery. */
  stem: string;
  /** Lowercase extension without dot, '' if none. */
  ext: string;
  /** Role implied by the filename alone (extension or suffix), or null. */
  roleHint: VariantRole | null;
}

export function splitExtension(filename: string): { base: string; ext: string } {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, idx), ext: name.slice(idx + 1).toLowerCase() };
}

export function normalizeStem(
  filename: string,
  suffixPatterns: Record<string, VariantRole> = DEFAULT_SUFFIX_PATTERNS
): StemResult {
  const { base, ext } = splitExtension(filename);
  // NFC so macOS (NFD) and Windows (NFC) exports of "José" pair up; casefold via toLowerCase.
  let stem = base.normalize('NFC').toLowerCase().trim();
  let roleHint: VariantRole | null = RAW_EXTENSIONS.has(ext) ? 'raw' : null;

  // Strip noise and role suffixes repeatedly: "IMG_0412-print-2" -> "img_0412".
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    // Lightroom duplicate counter: "-2", "-3" (but not a bare numeric stem like "0412").
    const dup = stem.match(/^(.*\D.*)[-_ ](\d{1,2})$/);
    if (dup && dup[1].length >= 2) { stem = dup[1]; changed = true; continue; }
    for (const [suffix, role] of Object.entries(suffixPatterns)) {
      const re = new RegExp(`^(.+?)[-_ ]${escapeRe(suffix.toLowerCase())}$`);
      const m = stem.match(re);
      if (m) { stem = m[1]; if (!roleHint) roleHint = role; changed = true; break; }
    }
    if (changed) continue;
    for (const noise of NOISE_SUFFIXES) {
      const re = new RegExp(`^(.+?)[-_ ]${noise}$`);
      const m = stem.match(re);
      if (m) { stem = m[1]; changed = true; break; }
    }
  }
  stem = stem.replace(/\s+/g, ' ').trim();
  return { stem, ext, roleHint };
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export interface InferRoleInput {
  filename: string;
  /** Explicit role from the drop zone or query parameter; always wins. */
  zoneRole?: VariantRole | null;
  /** Long edge in pixels when known (browser can read it cheaply for JPEGs). */
  longEdgePx?: number | null;
  /** Role to give an unsuffixed JPEG when size is unknown. */
  unsuffixedJpegRole?: VariantRole;
  suffixPatterns?: Record<string, VariantRole>;
}

/** Decide the variant role: zone > extension/suffix hint > size heuristic > default. */
export function inferRole(input: InferRoleInput): VariantRole {
  if (input.zoneRole) return input.zoneRole;
  const { ext, roleHint } = normalizeStem(input.filename, input.suffixPatterns);
  if (RAW_EXTENSIONS.has(ext)) return 'raw';
  if (roleHint) return roleHint;
  if (input.longEdgePx != null) return input.longEdgePx < 2500 ? 'social' : 'print';
  return input.unsuffixedJpegRole ?? 'print';
}

export function isAcceptedUpload(filename: string): boolean {
  const { ext } = splitExtension(filename);
  return IMAGE_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext) || sidecarRole(filename) !== null;
}

export function sidecarRole(filename: string): SidecarKind | null {
  const { ext } = splitExtension(filename);
  return ext === 'xmp' || ext === 'acr' ? ext : null;
}

/** A sidecar stays private even if it is selected in the RAW or full-size picker. */
export function inferUploadRole(input: Omit<InferRoleInput, 'zoneRole'> & { zoneRole?: UploadRole | null }): UploadRole {
  return sidecarRole(input.filename) ?? inferRole({ ...input, zoneRole: isVariantRole(input.zoneRole) ? input.zoneRole : null });
}

/** Group a batch of filenames by stem, for the pre-upload matrix. */
export function groupByStem(
  files: { name: string; zoneRole?: VariantRole | null; longEdgePx?: number | null }[],
  suffixPatterns?: Record<string, VariantRole>
): Map<string, Partial<Record<VariantRole, string>>> {
  const out = new Map<string, Partial<Record<VariantRole, string>>>();
  for (const f of files) {
    const { stem } = normalizeStem(f.name, suffixPatterns);
    const role = inferRole({ filename: f.name, zoneRole: f.zoneRole, longEdgePx: f.longEdgePx, suffixPatterns });
    const row = out.get(stem) ?? {};
    row[role] = f.name;
    out.set(stem, row);
  }
  return out;
}
