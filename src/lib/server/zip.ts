import archiver from 'archiver';
import { Readable } from 'node:stream';
import { createReadStream, promises as fs } from 'node:fs';
import { objectStat, openObject } from './blob-store';

/** Application entries use logical keys, never a provider URL. Absolute paths support local tools. */
export type ZipEntry = { name: string; expectedBytes?: number; expectedSha256?: string } & (
  { storagePath: string; absPath?: never; content?: never } |
  { absPath: string; storagePath?: never; content?: never } |
  { content: string | Buffer; storagePath?: never; absPath?: never }
);

/** Sanitize a zip entry path segment: no separators, control chars or reserved names. */
export function safeSegment(s: string): string {
  const cleaned = s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').trim();
  return cleaned || 'file';
}

/** `<Gallery>/<original filename>` with -2/-3 suffixes on collision. */
export function entryNamer() {
  const used = new Set<string>();
  return (folder: string, filename: string): string => {
    const seg = safeSegment(filename);
    const dot = seg.lastIndexOf('.');
    const base = dot > 0 ? seg.slice(0, dot) : seg, ext = dot > 0 ? seg.slice(dot) : '';
    let name = `${safeSegment(folder)}/${seg}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safeSegment(folder)}/${base}-${i}${ext}`;
    used.add(name.toLowerCase());
    return name;
  };
}

export class ZipError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Fail before sending headers, instead of handing a parent an apparently successful partial ZIP. */
export async function validateZipEntries(entries: ZipEntry[], maxBytes = Infinity): Promise<number> {
  let total = 0;
  for (const entry of entries) {
    try {
      const info = entry.storagePath !== undefined ? await objectStat(entry.storagePath)
        : entry.absPath !== undefined ? await fs.stat(entry.absPath).then((st) => { if (!st.isFile()) throw new Error('not a file'); return { size: st.size, sha256: undefined }; })
        : { size: Buffer.byteLength(entry.content), sha256: undefined };
      if (entry.expectedBytes !== undefined && info.size !== entry.expectedBytes) throw new Error('incomplete file');
      if (entry.expectedSha256 && info.sha256 && info.sha256 !== entry.expectedSha256) throw new Error('changed file');
      total += info.size;
    } catch { throw new ZipError(409, 'One of these photos is not available yet. Please refresh and try again, or choose the other photos.'); }
  }
  if (total > maxBytes) throw new ZipError(413, 'That is a big bundle! Choose fewer photos and download them in a couple of batches.');
  return total;
}

/** Stream end, error and close can all fire for a single archive. Release its slot exactly once. */
export function releaseOnce(callback: () => void): () => void {
  let released = false;
  return () => { if (!released) { released = true; callback(); } };
}

/** STORE-mode zip (photos are already compressed) as a Node stream; abortable via signal. */
export async function zipStream(entries: ZipEntry[], signal?: AbortSignal, maxBytes = Infinity): Promise<Readable> {
  await validateZipEntries(entries, maxBytes);
  const archive = archiver('zip', { store: true, zlib: { level: 0 } });
  let current: Readable | null = null;
  // Missing bytes after preflight must fail the stream, never silently omit selected photos.
  archive.on('warning', (e) => archive.destroy(e));
  const abort = () => { archive.abort(); archive.destroy(new Error('Download cancelled')); };
  const clean = () => { signal?.removeEventListener('abort', abort); current?.destroy(); };
  archive.once('end', clean); archive.once('close', clean); archive.once('error', clean);
  if (signal?.aborted) { setImmediate(abort); return archive; }
  signal?.addEventListener('abort', abort, { once: true });
  // Open one remote response at a time. Appending every stream eagerly buffers a whole shoot
  // and leaves hundreds of idle B2 connections waiting for the first archive entry.
  const produce = async () => {
    for (const entry of entries) {
      if (archive.destroyed || signal?.aborted) return;
      const source = entry.storagePath !== undefined ? await openObject(entry.storagePath)
        : entry.absPath !== undefined ? createReadStream(entry.absPath) : Readable.from([entry.content]);
      if (archive.destroyed || signal?.aborted) { source.destroy(); return; }
      current = source;
      await new Promise<void>((resolve, reject) => {
        const cleanEntry = () => { archive.off('entry', complete); archive.off('error', fail); archive.off('close', closed); source.off('error', fail); };
        const complete = () => { cleanEntry(); current = null; source.destroy(); resolve(); };
        const fail = (err: Error) => { cleanEntry(); reject(err); };
        const closed = () => fail(new Error('Download cancelled'));
        archive.once('entry', complete); archive.once('error', fail); archive.once('close', closed); source.once('error', fail);
        archive.append(source, { name: entry.name });
      });
    }
    if (!archive.destroyed) await archive.finalize();
  };
  // Defer until the caller has attached its error and cancellation handlers.
  setImmediate(() => { void produce().catch((err) => archive.destroy(err instanceof Error ? err : new Error(String(err)))); });
  return archive;
}

/** RFC 5987 Content-Disposition with an ASCII fallback. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
