import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
for (const d of ['db', 'originals', 'derivatives', 'cache/zips', 'tmp', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });

let secret = process.env.APP_SECRET ?? '';
if (!secret || secret === 'change-me' || secret.length < 16) {
  // Dev fallback: an ephemeral secret. Cookies and download tokens die with the process; fine for development, fatal for production.
  secret = randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') console.error('[env] APP_SECRET is not set; cookies will not survive a restart. Set APP_SECRET.');
}

export const env = {
  dataDir,
  secret,
  publicOrigin: (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
  allowPrivateNotify: process.env.GOTIFY_ALLOW_PRIVATE === '1',
  isProd: process.env.NODE_ENV === 'production',
  /** Max bytes per uploaded file (default 4 GB). */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 4 * 1024 * 1024 * 1024),
  /** Max photos per zip request. */
  maxZipPhotos: 500,
  zipCacheMaxBytes: Number(process.env.ZIP_CACHE_MAX_BYTES ?? 20 * 1024 * 1024 * 1024)
};

export function nowIso(): string { return new Date().toISOString(); }
