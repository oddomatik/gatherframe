import { promises as fs } from 'node:fs';
import { exiftool } from 'exiftool-vendored';
import type { SidecarKind } from '$shared/stem';

export const MAX_XMP_BYTES = 8 * 1024 * 1024;

/** A deliberately small owner-only index, not a Lightroom development recipe. */
export interface SidecarMetadata {
  rating: number | null;
  label: string | null;
  keywords: string[];
  title: string | null;
  description: string | null;
}

export function emptySidecarMetadata(): SidecarMetadata {
  return { rating: null, label: null, keywords: [], title: null, description: null };
}

function plainText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, limit) || null;
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).slice(0, 128)
    .map((item) => plainText(item, 200)).filter((item): item is string => item !== null);
}

/**
 * Archive bytes unchanged, but index only safe, bounded descriptive fields. ExifTool is
 * never invoked on DTDs, custom entities, binary/non-UTF8 XML or external instructions.
 * The normal shared ExifTool process has a timeout and is closed by shutdownImages().
 * Malformed packets and ACR companions remain useful as private archives, not renders.
 */
export async function readSidecarMetadata(absPath: string, kind: SidecarKind): Promise<{ metadata: SidecarMetadata; metadataWarning: string | null }> {
  const empty = emptySidecarMetadata();
  if (kind === 'acr') return { metadata: empty, metadataWarning: null };
  const warning = (message: string) => ({ metadata: empty, metadataWarning: message });
  if ((await fs.stat(absPath)).size > MAX_XMP_BYTES) return warning('XMP archived without indexing: metadata packet is too large.');
  const bytes = await fs.readFile(absPath);
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return warning('XMP archived without indexing: only UTF-8 metadata is supported.'); }
  const encoding = xml.match(/<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1];
  if (xml.includes('\0') || (encoding && !/^utf-?8$/i.test(encoding))) return warning('XMP archived without indexing: only UTF-8 metadata is supported.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)
    || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)[a-z_][\w.:-]*;/i.test(xml)
    || /<\?(?!(?:xml\s|xpacket\s))/i.test(xml)) {
    return warning('XMP archived without indexing: external declarations or custom entities are not supported.');
  }
  if (!xml.includes('<') || !/\brdf:RDF\b/.test(xml)) return warning('XMP archived without indexing: not a recognized XMP packet.');
  try {
    // These selectors intentionally exclude GPS, face regions, people tags and Develop settings.
    const tags = await exiftool.readRaw(absPath, { readArgs: [
      '-XMP-xmp:Rating', '-XMP-xmp:Label', '-XMP-dc:Subject', '-XMP-lr:HierarchicalSubject',
      '-XMP-dc:Title', '-XMP-dc:Description', '-Warning', '-Error'
    ], useMWG: false, ignoreMinorErrors: false }) as unknown as Record<string, unknown>;
    if (tags.Error || tags.Warning || (Array.isArray(tags.errors) && tags.errors.length)) {
      return warning('XMP archived without indexing: the metadata packet could not be read completely.');
    }
    const rating = typeof tags.Rating === 'number' ? tags.Rating : Number(tags.Rating);
    return {
      metadata: {
        rating: tags.Rating != null && Number.isInteger(rating) && rating >= -1 && rating <= 5 ? rating : null,
        label: plainText(tags.Label, 100),
        keywords: [...new Set([...strings(tags.Subject), ...strings(tags.HierarchicalSubject)])].slice(0, 128),
        title: plainText(tags.Title, 300),
        description: plainText(tags.Description, 2000)
      },
      metadataWarning: null
    };
  } catch {
    return warning('XMP archived without indexing: the metadata packet could not be read.');
  }
}
