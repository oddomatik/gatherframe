import path from 'node:path';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetBucketAclCommand } from '@aws-sdk/client-s3';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { env, nowIso } from './env';
import { storage, syncStorageParents } from './storage';

export type StorageMode = 'local' | 'b2' | 'mirror';
type StoredObject = typeof schema.storageObjects.$inferSelect;
type FileInfo = { sha256: string; bytes: number; mime: string };
type RemoteTarget = { endpoint: string; region: string; bucket: string; key: string; version?: string | null };
type Config = Omit<RemoteTarget, 'key' | 'version'> & { prefix: string; keyId: string; applicationKey: string };
type ConnectionTest = { fingerprint: string; at: string };

/** Safe to show to an administrator; never wraps or interpolates provider errors. */
export class StorageError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'StorageError'; }
}
function fail(code: string, message: string): never { throw new StorageError(code, message); }

function validatePath(rel: string): void {
  if (!rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((p) => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(rel)) fail('invalid_path', 'Invalid photo storage path.');
  storage.abs(rel);
}
function validEndpoint(endpoint: string, region: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) && endpoint === `https://s3.${region}.backblazeb2.com`;
}
function config(): Config {
  const endpoint = (process.env.B2_ENDPOINT ?? '').replace(/\/$/, '');
  const region = process.env.B2_REGION ?? '';
  const bucket = process.env.B2_BUCKET ?? '';
  const prefix = (process.env.B2_PREFIX ?? 'picture-day').replace(/^\/+|\/+$/g, '');
  const keyId = process.env.B2_KEY_ID ?? '';
  const applicationKey = process.env.B2_APPLICATION_KEY ?? '';
  if (!validEndpoint(endpoint, region) || !/^[a-zA-Z0-9][a-zA-Z0-9-]{4,61}[a-zA-Z0-9]$/.test(bucket) || !keyId || !applicationKey || (prefix && (!/^[a-zA-Z0-9_./-]+$/.test(prefix) || prefix.split('/').some((p) => !p || p === '.' || p === '..')))) {
    fail('not_configured', 'Configure a valid Backblaze B2 endpoint, region, private bucket, and application key on the server.');
  }
  return { endpoint, region, bucket, prefix, keyId, applicationKey };
}
function readSetting<T>(key: string): T | undefined {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return (row?.value as { v?: T } | undefined)?.v;
}
function writeSetting(key: string, value: unknown): void {
  const data = { value: { v: value }, updatedAt: nowIso() };
  db.insert(schema.settings).values({ key, ...data }).onConflictDoUpdate({ target: schema.settings.key, set: data }).run();
}
function mode(): StorageMode {
  const v = readSetting<string>('storage.mode');
  return v === 'b2' || v === 'mirror' ? v : 'local';
}
function fingerprint(c: Config): string { return createHash('sha256').update(JSON.stringify(c)).digest('hex'); }
function recentTest(c: Config): ConnectionTest | null {
  const t = readSetting<ConnectionTest>('storage.test');
  return t && t.fingerprint === fingerprint(c) && Date.now() - Date.parse(t.at) >= 0 && Date.now() - Date.parse(t.at) < 24 * 3600_000 ? t : null;
}
function targetOf(row: StoredObject): RemoteTarget | null {
  if (!row.remoteEndpoint || !row.remoteRegion || !row.remoteBucket || !row.remoteKey) return null;
  if (!validEndpoint(row.remoteEndpoint, row.remoteRegion)) fail('invalid_target', 'This photo has an invalid saved storage target.');
  return { endpoint: row.remoteEndpoint, region: row.remoteRegion, bucket: row.remoteBucket, key: row.remoteKey, version: row.remoteVersion };
}
function client(target: Pick<RemoteTarget, 'endpoint' | 'region'>): S3Client {
  if (!validEndpoint(target.endpoint, target.region)) fail('invalid_target', 'Invalid saved Backblaze B2 endpoint.');
  const keyId = process.env.B2_KEY_ID ?? '', applicationKey = process.env.B2_APPLICATION_KEY ?? '';
  if (!keyId || !applicationKey) fail('not_configured', 'Backblaze B2 credentials are unavailable on the server.');
  return new S3Client({
    endpoint: target.endpoint, region: target.region, forcePathStyle: true,
    credentials: { accessKeyId: keyId, secretAccessKey: applicationKey }, maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    // Large originals may legitimately take minutes; bound idle sockets, not total transfer time.
    requestHandler: { connectionTimeout: 10_000, socketTimeout: 120_000 }
  });
}
function objectInput(t: RemoteTarget) { return { Bucket: t.bucket, Key: t.key, ...(t.version ? { VersionId: t.version } : {}) }; }
function record(rel: string): StoredObject | undefined { validatePath(rel); return db.select().from(schema.storageObjects).where(eq(schema.storageObjects.storagePath, rel)).get(); }
async function localExists(rel: string): Promise<boolean> {
  try { return (await fs.stat(storage.abs(rel))).isFile(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
function remoteError(error: unknown): never {
  if (error instanceof StorageError) throw error;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === 'NoSuchKey' || e.name === 'NoSuchVersion' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) fail('missing', 'This photo file is missing from Backblaze B2.');
  fail('remote_unavailable', 'Backblaze B2 could not complete the request. Check the connection, bucket, and application-key permissions, then retry.');
}

async function hashFile(abs: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(abs)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
function integrity(expected: Pick<FileInfo, 'bytes' | 'sha256'>): Transform {
  const hash = createHash('sha256'); let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > expected.bytes) return done(new StorageError('integrity', 'Photo file size verification failed. The original upload was retained.'));
      hash.update(chunk); done(null, chunk);
    },
    flush(done) {
      if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) done(new StorageError('integrity', 'Photo checksum verification failed. The original upload was retained.'));
      else done();
    }
  });
}
async function getRemote(t: RemoteTarget, range?: { start: number; end: number }): Promise<Readable> {
  const s3 = client(t);
  try {
    const response = await s3.send(new GetObjectCommand({ ...objectInput(t), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
    if (!response.Body || !(Symbol.asyncIterator in response.Body)) fail('remote_unavailable', 'Backblaze B2 returned an unreadable photo.');
    const body = response.Body as Readable;
    if (range) {
      const contentRange = response.ContentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (response.ContentLength !== range.end - range.start + 1 || !contentRange || Number(contentRange[1]) !== range.start || Number(contentRange[2]) !== range.end || Number(contentRange[3]) <= range.end) {
        body.destroy(); fail('invalid_range', 'Backblaze B2 returned an unexpected photo range.');
      }
    }
    const output = Readable.from((async function* () {
      try { for await (const chunk of body) yield chunk; }
      catch (e) { remoteError(e); }
      finally { body.destroy(); s3.destroy(); }
    })());
    // The generator may never begin when a client cancels before the first read.
    output.once('close', () => { body.destroy(); s3.destroy(); });
    return output;
  } catch (e) { s3.destroy(); remoteError(e); }
}
async function verifyRemote(t: RemoteTarget, info: FileInfo): Promise<void> {
  const stream = await getRemote(t);
  await pipeline(stream, integrity(info), new Transform({ transform(_chunk, _encoding, done) { done(); } }));
}

/** Reserve headroom before temporary writes. Can only be disabled explicitly inside tests. */
export async function assertScratchSpace(bytes: number): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('invalid_size', 'Invalid photo file size.');
  if (process.env.NODE_ENV === 'test' && process.env.STORAGE_SKIP_SPACE_CHECK === '1') return;
  const floor = Number(process.env.STORAGE_MIN_FREE_BYTES ?? 256 * 1024 * 1024);
  if (!Number.isSafeInteger(floor) || floor < 0) fail('invalid_config', 'STORAGE_MIN_FREE_BYTES must be a non-negative byte count.');
  const available = await fs.statfs(env.dataDir);
  if (available.bavail * available.bsize < bytes + floor + scratchReserved) fail('disk_full', 'Not enough temporary disk space. Free some server space or use a smaller upload batch.');
}

/** Caller serializes writes/garbage collection with withStorageLock(rel). */
export async function storeFile(rel: string, sourceAbs: string, info: FileInfo): Promise<void> {
  const previous = record(rel);
  if (!/^[a-f0-9]{64}$/.test(info.sha256) || !Number.isSafeInteger(info.bytes) || info.bytes < 0) fail('invalid_file', 'Invalid photo file metadata.');
  if (previous && (previous.sha256 !== info.sha256 || previous.bytes !== info.bytes)) fail('immutable_conflict', 'This photo storage path already belongs to different bytes.');
  const actual = await hashFile(sourceAbs);
  if (actual.sha256 !== info.sha256 || actual.bytes !== info.bytes) fail('integrity', 'The uploaded photo failed checksum verification.');
  const selected = mode(), needsRemote = selected !== 'local';
  const alreadyLocal = await localExists(rel);
  const wantsLocal = selected !== 'b2' || alreadyLocal || Boolean(previous?.localAvailable);
  let remote = previous ? targetOf(previous) : null;
  let remoteVerified = previous?.remoteVerifiedAt ?? null;
  if (needsRemote) {
    const c = config();
    if (readSetting<string>('storage.approved') !== fingerprint(c)) fail('not_tested', 'The Backblaze B2 configuration changed. Test the connection and save the storage choice again before uploading.');
    remote ??= { endpoint: c.endpoint, region: c.region, bucket: c.bucket, key: [c.prefix, rel].filter(Boolean).join('/') };
    // A registered target is never overwritten just because upload configuration changed.
    // Verify an existing version; repair only after a definite missing-object response.
    let mustPut = !remoteVerified;
    if (!mustPut) {
      try { await verifyRemote(remote, info); }
      catch (e) { if (e instanceof StorageError && e.code === 'missing') mustPut = true; else throw e; }
    }
    if (mustPut) {
      const s3 = client(remote); const body = createReadStream(sourceAbs);
      try {
        const result = await s3.send(new PutObjectCommand({ Bucket: remote.bucket, Key: remote.key, Body: body, ContentLength: info.bytes, ContentType: info.mime, Metadata: { sha256: info.sha256 } }));
        remote = { ...remote, version: result.VersionId ?? null };
        await verifyRemote(remote, info);
      } catch (e) { remoteError(e); }
      finally { body.destroy(); s3.destroy(); }
    }
    remoteVerified = nowIso();
  }
  let localVerified = previous?.localVerifiedAt ?? null;
  if (wantsLocal) {
    const dest = storage.abs(rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (path.resolve(sourceAbs) !== dest) {
      // Preserve the staged source until both providers and the inventory are durable.
      const stage = `${dest}.install-${randomBytes(8).toString('hex')}`;
      try {
        await assertScratchSpace(info.bytes);
        await fs.copyFile(sourceAbs, stage);
        const handle = await fs.open(stage, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
        await fs.rename(stage, dest);
        await syncStorageParents(path.dirname(dest));
      } finally { await fs.unlink(stage).catch(() => {}); }
    }
    localVerified = nowIso();
  }
  const now = nowIso();
  const values = {
    storagePath: rel, sha256: info.sha256, bytes: info.bytes, mime: info.mime,
    localAvailable: wantsLocal ? 1 : 0, localVerifiedAt: localVerified,
    remoteEndpoint: remote?.endpoint ?? null, remoteRegion: remote?.region ?? null,
    remoteBucket: remote?.bucket ?? null, remoteKey: remote?.key ?? null, remoteVersion: remote?.version ?? null,
    remoteVerifiedAt: remoteVerified, createdAt: previous?.createdAt ?? now, updatedAt: now
  };
  db.insert(schema.storageObjects).values(values).onConflictDoUpdate({ target: schema.storageObjects.storagePath, set: values }).run();
  if (path.resolve(sourceAbs) !== storage.abs(rel)) await fs.unlink(sourceAbs);
}

export async function objectStat(rel: string): Promise<{ size: number; sha256?: string }> {
  const row = record(rel);
  if (!row || row.localAvailable) {
    try {
      const stat = await fs.stat(storage.abs(rel));
      if (!stat.isFile()) fail('missing', 'This photo file is unavailable.');
      if (row && stat.size !== row.bytes) fail('integrity', 'The stored photo file size has changed.');
      return { size: stat.size, ...(row ? { sha256: row.sha256 } : {}) };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !row?.remoteKey) throw e; }
  }
  const target = row && targetOf(row);
  if (!target) fail('missing', 'This photo file is unavailable.');
  const s3 = client(target);
  try {
    const head = await s3.send(new HeadObjectCommand(objectInput(target)), { abortSignal: AbortSignal.timeout(8_000) });
    if (head.ContentLength !== row.bytes || (head.Metadata?.sha256 && head.Metadata.sha256 !== row.sha256)) fail('integrity', 'The stored photo metadata no longer matches the verified file.');
    return { size: head.ContentLength, sha256: row.sha256 };
  } catch (e) { remoteError(e); }
  finally { s3.destroy(); }
}

export async function openObject(rel: string, range?: { start: number; end: number }): Promise<Readable> {
  const row = record(rel);
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || (row && range.end >= row.bytes))) fail('invalid_range', 'Invalid photo byte range.');
  if ((!row || row.localAvailable) && await localExists(rel)) return createReadStream(storage.abs(rel), range);
  const target = row && targetOf(row);
  if (!target) fail('missing', 'This photo file is unavailable.');
  return getRemote(target, range);
}

let scratchActive = 0, scratchReserved = 0;
const scratchWaiters: (() => void)[] = [];
async function acquireScratch(): Promise<() => void> {
  const n = Math.max(1, Math.min(8, Number(process.env.STORAGE_MATERIALIZE_CONCURRENCY ?? 2) || 2));
  if (scratchActive >= n) await new Promise<void>((resolve) => scratchWaiters.push(resolve));
  else scratchActive++;
  return () => { const next = scratchWaiters.shift(); if (next) next(); else scratchActive--; };
}
export async function materializeObject(rel: string): Promise<{ path: string; release: () => Promise<void> }> {
  const row = record(rel);
  if ((!row || row.localAvailable) && await localExists(rel)) return { path: storage.abs(rel), release: async () => {} };
  const target = row && targetOf(row);
  if (!target) fail('missing', 'This photo file is unavailable.');
  const unlock = await acquireScratch();
  const temp = storage.abs(`tmp/materialized-${randomBytes(16).toString('hex')}${path.extname(rel)}`);
  let reserved = false, released = false;
  const release = async () => {
    if (released) return; released = true;
    try { await fs.unlink(temp).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }); }
    finally { if (reserved) scratchReserved -= row.bytes; unlock(); }
  };
  try {
    await fs.mkdir(path.dirname(temp), { recursive: true });
    await assertScratchSpace(row.bytes); scratchReserved += row.bytes; reserved = true;
    await pipeline(await getRemote(target), integrity(row), createWriteStream(temp, { flags: 'wx' }));
    return { path: temp, release };
  } catch (e) { await release(); throw e; }
}

/** Only call after proving the immutable path is unreferenced, under withStorageLock. */
export async function deleteObject(rel: string): Promise<void> {
  const row = record(rel), target = row && targetOf(row);
  if (target) {
    const s3 = client(target);
    try { await s3.send(new DeleteObjectCommand(objectInput(target))); }
    catch (e) { remoteError(e); }
    finally { s3.destroy(); }
  }
  await fs.unlink(storage.abs(rel)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  db.delete(schema.storageObjects).where(eq(schema.storageObjects.storagePath, rel)).run();
}

export async function storageStatus(): Promise<{ mode: StorageMode; configured: boolean; endpoint: string; bucket: string; prefix: string; counts: { local: number; remote: number }; testedAt: string | null }> {
  let c: Config | null = null;
  try { c = config(); } catch { /* Incomplete configuration is a normal setup state. */ }
  const counts = db.select({ local: sql<number>`coalesce(sum(case when ${schema.storageObjects.localAvailable} = 1 then 1 else 0 end), 0)`, remote: sql<number>`coalesce(sum(case when ${schema.storageObjects.remoteVerifiedAt} is not null then 1 else 0 end), 0)` }).from(schema.storageObjects).get()!;
  return {
    mode: mode(), configured: !!c, endpoint: c?.endpoint ?? '', bucket: c?.bucket ?? '', prefix: c?.prefix ?? '',
    counts,
    testedAt: c ? recentTest(c)?.at ?? null : null
  };
}
export async function testStorageConnection(): Promise<void> {
  const c = config(), s3 = client(c);
  const body = randomBytes(64), info = { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, mime: 'application/octet-stream' };
  const target: RemoteTarget = { ...c, key: [c.prefix, '.connection-tests', randomBytes(24).toString('hex')].filter(Boolean).join('/') };
  let written = false;
  // A failed retest must not leave an older successful result authorizing a mode change.
  writeSetting('storage.test', null);
  try {
    const acl = await s3.send(new GetBucketAclCommand({ Bucket: c.bucket }));
    if (!acl.Grants || acl.Grants.some((g) => g.Grantee?.Type === 'Group')) fail('public_bucket', 'Use a private Backblaze B2 bucket. Public buckets expose photos outside the app access rules.');
    const result = await s3.send(new PutObjectCommand({ Bucket: target.bucket, Key: target.key, Body: body, ContentLength: info.bytes, ContentType: info.mime, Metadata: { sha256: info.sha256 } }));
    target.version = result.VersionId ?? null; written = true;
    await verifyRemote(target, info);
    const head = await s3.send(new HeadObjectCommand(objectInput(target)), { abortSignal: AbortSignal.timeout(8_000) });
    if (head.ContentLength !== info.bytes || head.Metadata?.sha256 !== info.sha256) fail('integrity', 'Backblaze B2 did not preserve the verified file metadata.');
    await s3.send(new DeleteObjectCommand(objectInput(target))); written = false;
    writeSetting('storage.test', { fingerprint: fingerprint(c), at: nowIso() });
  } catch (e) { remoteError(e); }
  finally {
    if (written) await s3.send(new DeleteObjectCommand(objectInput(target))).catch(() => {});
    s3.destroy();
  }
}
export async function setStorageMode(next: StorageMode): Promise<void> {
  if (next !== 'local' && next !== 'b2' && next !== 'mirror') fail('invalid_mode', 'Choose local disk, Backblaze B2, or both.');
  if (next !== 'local') {
    const c = config();
    if (!recentTest(c)) fail('not_tested', 'Test this Backblaze B2 connection successfully before enabling it.');
    writeSetting('storage.approved', fingerprint(c));
  }
  writeSetting('storage.mode', next);
}
