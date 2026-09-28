import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { env } from './env';
import type { VariantRole } from '$shared/stem';

/** All paths are relative to DATA_DIR and never derived from client-provided filenames. */
export const storage = {
  original(eventId: number, photoId: number, role: VariantRole, ext: string): string {
    return path.join('originals', String(eventId), String(photoId), `${role}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`);
  },
  /** Immutable object name; a photo row is published only after these bytes are durable. */
  originalVersion(eventId: number, sha256: string, ext: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid object hash');
    return path.join('originals', String(eventId), 'objects', `${sha256}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`);
  },
  derivative(eventId: number, photoId: number, kind: 'thumb' | 'preview' | 'web', renditionHash?: string | null): string {
    // Legacy rows use flat paths until their first new render. Never fall back for versioned rows.
    const version = renditionHash?.startsWith('v2-') ? renditionHash : null;
    if (version && !/^v2-[a-f0-9]{64}-[a-zA-Z0-9_-]+$/.test(version)) throw new Error('invalid rendition version');
    return path.join('derivatives', String(eventId), String(photoId), ...(version ? [version] : []), `${kind}.webp`);
  },
  photoDir(eventId: number, photoId: number): string { return path.join('originals', String(eventId), String(photoId)); },
  derivativeDir(eventId: number, photoId: number): string { return path.join('derivatives', String(eventId), String(photoId)); },
  zipCache(token: string): string { return path.join('cache', 'zips', `${token}.zip`); },
  tmp(name: string): string { return path.join('tmp', name); },
  abs(rel: string): string {
    const p = path.resolve(env.dataDir, rel);
    if (!p.startsWith(env.dataDir + path.sep) && p !== env.dataDir) throw new Error('path escapes DATA_DIR');
    return p;
  }
};

const objectLocks = new Map<string, Promise<void>>();
/** Serialize publish and garbage collection of the same immutable object in this process. */
export async function withStorageLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = objectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  objectLocks.set(key, tail);
  await previous;
  try { return await work(); }
  finally { release(); if (objectLocks.get(key) === tail) objectLocks.delete(key); }
}

/** Persist new directory entries all the way to DATA_DIR before publishing a DB pointer. */
export async function syncStorageParents(absDirectory: string): Promise<void> {
  let dir = absDirectory;
  while (dir === env.dataDir || dir.startsWith(env.dataDir + path.sep)) {
    const handle = await fsp.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    if (dir === env.dataDir) break;
    dir = path.dirname(dir);
  }
}
