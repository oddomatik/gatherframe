import { splitExtension } from '$shared/stem';
import { safeSegment, type ZipEntry } from './zip';

type SourceFile = { originalFilename: string; ext: string; storagePath: string; bytes: number; sha256: string };
type SourceSidecar = SourceFile & { kind: 'xmp' | 'acr' };

/** RAW editors discover companions by basename. Keep all current companions together,
 * rather than applying the parent download's photo-ID/role naming convention. */
export function sourceArchiveEntries(raw: SourceFile, sidecars: SourceSidecar[]): { filename: string; entries: ZipEntry[] } {
  let base = safeSegment(splitExtension(raw.originalFilename).base).replace(/[. ]+$/, '');
  if (!base || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(base)) base = `photo-${base || 'source'}`;
  // Leave plenty of room for extensions on filesystems with a 255-byte component limit.
  while (Buffer.byteLength(base, 'utf8') > 200) base = Array.from(base).slice(0, -1).join('');
  const ext = /^[a-z0-9]{1,12}$/i.test(raw.ext) ? raw.ext.toLowerCase() : 'raw';
  const entry = (file: SourceFile, extension: string): ZipEntry => ({
    name: `${base}.${extension}`, storagePath: file.storagePath, expectedBytes: file.bytes, expectedSha256: file.sha256
  });
  return {
    filename: `${base}-RAW-and-sidecars.zip`,
    entries: [entry(raw, ext), ...sidecars.filter((s) => s.kind === 'xmp' || s.kind === 'acr').sort((a, b) => a.kind.localeCompare(b.kind)).map((s) => entry(s, s.kind))]
  };
}
