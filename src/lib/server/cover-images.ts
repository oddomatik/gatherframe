import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { materializeObject } from './blob-store';
import { storage, withStorageLock } from './storage';

export const COVER_RECIPE = 'cover-v1';
export const COVER_WIDTHS = { cover640: 640, cover960: 960, cover1440: 1440 } as const;
export type CoverKind = keyof typeof COVER_WIDTHS;
export function isCoverKind(kind: string): kind is CoverKind { return Object.hasOwn(COVER_WIDTHS, kind); }
const cacheDir = () => storage.abs('cache/covers');
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve)); else active++;
  return () => { const next = waiters.shift(); if (next) next(); else active--; };
}

/** Disposable web-display cache, derived only from an existing web rendition.
 * Originals, current photo metadata, storage mode and B2 objects are not changed.
 */
export async function coverImage(sourceKey: string, kind: CoverKind, immutable: boolean): Promise<Buffer> {
  const key = createHash('sha256').update(`${COVER_RECIPE}:${sourceKey}:${kind}`).digest('hex') + '.webp';
  const destination = path.join(cacheDir(), key);
  return withStorageLock(destination, async () => {
    if (immutable) {
      try { return await fs.readFile(destination); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    const release = await acquire();
    let input: Awaited<ReturnType<typeof materializeObject>> | undefined;
    let temp: string | undefined;
    try {
      input = await materializeObject(sourceKey);
      const bytes = await sharp(input.path, { limitInputPixels: 400e6 }).rotate()
        .resize({ width: COVER_WIDTHS[kind], withoutEnlargement: true })
        .webp({ quality: 74, effort: 4 }).toBuffer();
      if (immutable) {
        await fs.mkdir(cacheDir(), { recursive: true });
        temp = destination + '.' + randomBytes(8).toString('hex') + '.tmp';
        await fs.writeFile(temp, bytes, { flag: 'wx' });
        await fs.rename(temp, destination);
      }
      return bytes;
    } finally {
      try { if (temp) await fs.rm(temp, { force: true }); await input?.release(); }
      finally { release(); }
    }
  });
}

/** Only regenerated display copies: keep at most 256 MiB and discard copies over 30 days old. */
export async function pruneCoverCache(): Promise<void> {
  const dir = cacheDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const files = (await Promise.all(names.filter(n => /^[a-f0-9]{64}\.webp(?:\.[a-f0-9]+\.tmp)?$/.test(n)).map(async name => {
    const file = path.join(dir, name), stat = await fs.stat(file).catch(() => null);
    return stat?.isFile() ? { file, bytes: stat.size, age: stat.mtimeMs, temporary: name.endsWith('.tmp') } : null;
  }))).filter(f => f !== null).sort((a,b) => a.age - b.age);
  let total = files.reduce((sum,f) => sum + f.bytes, 0);
  for (const f of files) {
    const expired = Date.now() - f.age > (f.temporary ? 1 : 30) * 86400_000;
    if (expired || (!f.temporary && total > 256 * 1024 * 1024)) {
      await withStorageLock(f.file, () => fs.rm(f.file, { force: true })); total -= f.bytes;
    }
  }
}
