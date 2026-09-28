import { photoKey } from './photo-key';
import { RAW_EXTENSIONS, sidecarRole, splitExtension, type SidecarKind, type UploadRole, type VariantRole } from './stem';

function folderRole(folder: string): VariantRole | null {
  folder = folder.trim();
  if (/^(print|full|full[-_ ]?resolution|hires|high[-_ ]?res|jpeg|jpg)$/i.test(folder)) return 'print';
  if (/^(social|web|web[-_ ]?size)$/i.test(folder)) return 'social';
  return /^raw$/i.test(folder) ? 'raw' : null;
}

/** Folders tell us the version, never the photo's identity or collection. */
export function sourceFolder(relativePath: string): { path: string; label: string; role: VariantRole | null } {
  const parts = relativePath.replaceAll('\\', '/').split('/').slice(0, -1);
  return {
    path: parts.join('/'), label: parts.at(-1) || 'Files',
    role: [...parts].reverse().map(folderRole).find((role) => role !== null) ?? null
  };
}

export type ImportSource = { name: string; webkitRelativePath?: string };

/** Keep duplicate slots visible for review; never silently choose the last file. */
export function planImportFiles<T extends ImportSource>(files: T[], zoneRole: VariantRole | null = null, defaultRole: VariantRole = 'print') {
  const rows = new Map<string, { file: T; role: UploadRole }[]>();
  for (const file of files) {
    const key = photoKey(file.name);
    const raw = RAW_EXTENSIONS.has(splitExtension(file.name).ext);
    // Edit companions are never image variants, even when dropped into a JPEG zone.
    // A named export subfolder describes its contents even when the parent was
    // selected from a single-version picker. The picker is a fallback for loose
    // files or unrecognized folders, not an override of full/social/raw.
    const role = sidecarRole(file.name) ?? (raw ? 'raw' : sourceFolder(file.webkitRelativePath || file.name).role ?? zoneRole ?? defaultRole);
    const entries = rows.get(key) ?? [];
    entries.push({ file, role }); rows.set(key, entries);
  }
  return rows;
}

/** Compare only competing slots, in bounded chunks (including on plain LAN HTTP).
 * Names, size and modification time alone cannot establish byte equality. */
export async function sameImportBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  const chunk = 1024 * 1024;
  for (let offset = 0; offset < a.size; offset += chunk) {
    const [left, right] = await Promise.all([
      a.slice(offset, offset + chunk).arrayBuffer(), b.slice(offset, offset + chunk).arrayBuffer()
    ]);
    const x = new Uint8Array(left), y = new Uint8Array(right);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

export type ImportPhoto = {
  id: number;
  stem: string;
  matchKeys: string[];
  files: { role: string; originalFilename: string }[];
  sidecars?: { kind: SidecarKind; originalFilename: string }[];
  collections: { id: number; name: string; isIntake: number; isArchived: number }[];
};

/** Imported photos can be anywhere in the event, including shared/archived collections. */
export function findImportMatches(photos: ImportPhoto[], key: string, stemOverride?: string): ImportPhoto[] {
  return photos.filter((photo) => stemOverride ? photo.stem === stemOverride : photo.matchKeys.includes(key));
}
