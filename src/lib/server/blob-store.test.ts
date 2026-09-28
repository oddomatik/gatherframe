import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';

const mock = vi.hoisted(() => ({
  files: new Map<string, { body: Buffer; sha256: string; version: string }>(),
  calls: [] as { endpoint: string; name: string; input: Record<string, any> }[],
  failure: '', corruptGet: false, publicBucket: false, badRange: false,
  streams: [] as { destroyed: boolean }[], destroyedClients: 0,
  headSize: null as number | null, serial: 0
}));
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { env: { dataDir: mkdtempSync(join(tmpdir(), 'picture-day-storage-')) }, nowIso: () => new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  const { Readable } = await import('node:stream');
  return { ...actual, S3Client: class {
    constructor(private options: { endpoint: string }) {}
    destroy() { mock.destroyedClients++; }
    async send(command: { input: Record<string, any>; constructor: { name: string } }) {
      const name = command.constructor.name, input = command.input;
      mock.calls.push({ endpoint: this.options.endpoint, name, input });
      if (mock.failure === name) throw new Error('provider included TOP-SECRET-APPLICATION-KEY and PRIVATE-KEY-ID');
      const key = `${this.options.endpoint}/${input.Bucket}/${input.Key}`;
      if (name === 'GetBucketAclCommand') return { Grants: mock.publicBucket ? [{ Grantee: { Type: 'Group' } }] : [{ Grantee: { Type: 'CanonicalUser' } }] };
      if (name === 'PutObjectCommand') {
        const chunks: Buffer[] = [];
        if (Buffer.isBuffer(input.Body)) chunks.push(input.Body);
        else for await (const chunk of input.Body) chunks.push(Buffer.from(chunk));
        const version = `v-${++mock.serial}`;
        mock.files.set(key, { body: Buffer.concat(chunks), sha256: input.Metadata.sha256, version });
        return { VersionId: version };
      }
      const file = mock.files.get(key);
      if (name === 'DeleteObjectCommand') { mock.files.delete(key); return {}; }
      if (!file || (input.VersionId && input.VersionId !== file.version)) throw Object.assign(new Error('absent'), { name: 'NoSuchKey' });
      if (name === 'HeadObjectCommand') return { ContentLength: mock.headSize ?? file.body.length, Metadata: { sha256: file.sha256 }, VersionId: file.version };
      if (name === 'GetObjectCommand') {
        const match = input.Range?.match(/^bytes=(\d+)-(\d+)$/);
        const body = match ? file.body.subarray(Number(match[1]), Number(match[2]) + 1) : mock.corruptGet ? Buffer.alloc(file.body.length, 0) : file.body;
        const stream = Readable.from([body]); mock.streams.push(stream);
        return { Body: stream, ContentLength: body.length, ContentRange: match && !mock.badRange ? `bytes ${match[1]}-${match[2]}/${file.body.length}` : undefined };
      }
      throw new Error(`Unexpected command ${name}`);
    }
  } };
});

import { db, schema, sqlite } from './db';
import { env } from './env';
import { storage } from './storage';
import { storeFile, objectStat, openObject, materializeObject, deleteObject, storageStatus, testStorageConnection, setStorageMode, assertScratchSpace } from './blob-store';

beforeEach(async () => {
  mock.files.clear(); mock.calls.length = 0; mock.failure = ''; mock.corruptGet = false; mock.publicBucket = false; mock.headSize = null;
  mock.badRange = false; mock.streams.length = 0; mock.destroyedClients = 0;
  sqlite.exec('DELETE FROM storage_objects; DELETE FROM settings;');
  await fs.rm(env.dataDir, { recursive: true, force: true });
  await fs.mkdir(storage.abs('tmp'), { recursive: true });
  vi.stubEnv('B2_ENDPOINT', 'https://s3.us-west-004.backblazeb2.com');
  vi.stubEnv('B2_REGION', 'us-west-004');
  vi.stubEnv('B2_BUCKET', 'private-photo-fixture');
  vi.stubEnv('B2_PREFIX', 'fixture');
  vi.stubEnv('B2_KEY_ID', 'PRIVATE-KEY-ID');
  vi.stubEnv('B2_APPLICATION_KEY', 'TOP-SECRET-APPLICATION-KEY');
  vi.stubEnv('STORAGE_MIN_FREE_BYTES', '0');
  vi.stubEnv('STORAGE_SKIP_SPACE_CHECK', '');
});
afterAll(async () => { sqlite.close(); vi.unstubAllEnvs(); await fs.rm(env.dataDir, { recursive: true, force: true }); });
function info(bytes: Buffer) { return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: 'image/jpeg' }; }
async function staged(bytes = Buffer.from('finished photograph bytes')) { const file = storage.abs(`tmp/source-${Math.random()}.jpg`); await fs.writeFile(file, bytes); return { file, bytes, info: info(bytes) }; }
async function bytes(stream: Readable) { const parts = []; for await (const b of stream) parts.push(Buffer.from(b)); return Buffer.concat(parts); }
async function remoteMode(mode: 'b2' | 'mirror' = 'b2') { await testStorageConnection(); await setStorageMode(mode); mock.calls.length = 0; }

describe('local and Backblaze file inventory', () => {
  it('defaults to local, durably installs bytes, and supports unregistered legacy files', async () => {
    const source = await staged();
    await storeFile('originals/1/photo.jpg', source.file, source.info);
    expect(await bytes(await openObject('originals/1/photo.jpg'))).toEqual(source.bytes);
    expect(await objectStat('originals/1/photo.jpg')).toEqual({ size: source.bytes.length, sha256: source.info.sha256 });
    await expect(fs.stat(source.file)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.writeFile(storage.abs('tmp/legacy.jpg'), source.bytes);
    expect(await objectStat('tmp/legacy.jpg')).toEqual({ size: source.bytes.length });
    expect(await bytes(await openObject('tmp/legacy.jpg', { start: 1, end: 5 }))).toEqual(source.bytes.subarray(1, 6));
    const local = await materializeObject('tmp/legacy.jpg'); await local.release();
    expect(await fs.readFile(local.path)).toEqual(source.bytes);
    expect((await storageStatus()).mode).toBe('local');
    expect(mock.calls).toHaveLength(0);
  });

  it('requires a private tested connection, invalidates tests after config or key changes, and never reveals credentials', async () => {
    await expect(setStorageMode('b2')).rejects.toMatchObject({ code: 'not_tested' });
    mock.publicBucket = true;
    await expect(testStorageConnection()).rejects.toMatchObject({ code: 'public_bucket' });
    expect(mock.files.size).toBe(0);
    mock.publicBucket = false;
    await testStorageConnection();
    expect(mock.files.size).toBe(0);
    expect((await storageStatus()).testedAt).not.toBeNull();
    vi.stubEnv('B2_APPLICATION_KEY', 'different-private-key');
    const status = await storageStatus();
    expect(status.testedAt).toBeNull();
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE-KEY|SECRET|different-private/);
    await expect(setStorageMode('mirror')).rejects.toMatchObject({ code: 'not_tested' });
    vi.stubEnv('B2_ENDPOINT', 'https://PRIVATE-KEY-ID:TOP-SECRET-APPLICATION-KEY@127.0.0.1');
    expect(await storageStatus()).toMatchObject({ configured: false, endpoint: '' });
    await expect(testStorageConnection()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('publishes verified remote-only files, pins versions and ranges, and materializes disposable checked scratch files', async () => {
    await remoteMode();
    const source = await staged();
    await storeFile('originals/2/photo.jpg', source.file, source.info);
    await expect(fs.stat(storage.abs('originals/2/photo.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    const row = db.select().from(schema.storageObjects).get()!;
    expect(row.localAvailable).toBe(0); expect(row.remoteVersion).toBeTruthy();
    expect(await objectStat(row.storagePath)).toEqual({ size: source.bytes.length, sha256: source.info.sha256 });
    expect(await bytes(await openObject(row.storagePath, { start: 2, end: 6 }))).toEqual(source.bytes.subarray(2, 7));
    expect(mock.calls.filter((c) => c.name === 'GetObjectCommand').every((c) => c.input.VersionId === row.remoteVersion)).toBe(true);
    const materialized = await materializeObject(row.storagePath);
    expect(await fs.readFile(materialized.path)).toEqual(source.bytes);
    await materialized.release(); await materialized.release();
    await expect(fs.stat(materialized.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await storageStatus()).toMatchObject({ counts: { local: 0, remote: 1 } });
  });

  it('never repoints stored objects when mode/bucket/prefix changes and retains local copies', async () => {
    await remoteMode('mirror');
    const source = await staged();
    await storeFile('originals/3/photo.jpg', source.file, source.info);
    const initial = db.select().from(schema.storageObjects).get()!;
    await setStorageMode('local');
    await fs.unlink(storage.abs(initial.storagePath));
    expect(await bytes(await openObject(initial.storagePath))).toEqual(source.bytes);
    vi.stubEnv('B2_BUCKET', 'another-photo-bucket'); vi.stubEnv('B2_PREFIX', 'different');
    await remoteMode();
    const again = await staged(source.bytes);
    await storeFile(initial.storagePath, again.file, again.info);
    expect(db.select().from(schema.storageObjects).get()).toMatchObject({ remoteBucket: initial.remoteBucket, remoteKey: initial.remoteKey, remoteVersion: initial.remoteVersion, localAvailable: 1 });
    expect(await fs.readFile(storage.abs(initial.storagePath))).toEqual(source.bytes);
    expect(mock.calls.filter((c) => c.name === 'GetObjectCommand').every((c) => c.input.Bucket === initial.remoteBucket)).toBe(true);
  });

  it('keeps staged sources and inventory untouched after failed uploads or checksum failures', async () => {
    await remoteMode();
    const source = await staged();
    mock.failure = 'PutObjectCommand';
    await expect(storeFile('originals/fail.jpg', source.file, source.info)).rejects.toMatchObject({ code: 'remote_unavailable' });
    try { await storeFile('originals/fail.jpg', source.file, source.info); } catch (e) { expect(String(e)).not.toMatch(/TOP-SECRET|PRIVATE-KEY/); }
    expect(await fs.readFile(source.file)).toEqual(source.bytes);
    expect(db.select().from(schema.storageObjects).all()).toHaveLength(0);
    mock.failure = ''; mock.corruptGet = true;
    await expect(storeFile('originals/corrupt.jpg', source.file, source.info)).rejects.toMatchObject({ code: 'integrity' });
    expect(await fs.readFile(source.file)).toEqual(source.bytes);
    expect(db.select().from(schema.storageObjects).all()).toHaveLength(0);
  });

  it('rejects bad source hashes, immutable collisions, and paths escaping storage', async () => {
    const source = await staged();
    await expect(storeFile('../outside.jpg', source.file, source.info)).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(storeFile('originals/bad.jpg', source.file, { ...source.info, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'integrity' });
    await storeFile('originals/immutable.jpg', source.file, source.info);
    const another = await staged(Buffer.from('different photograph'));
    await expect(storeFile('originals/immutable.jpg', another.file, another.info)).rejects.toMatchObject({ code: 'immutable_conflict' });
    expect(await bytes(await openObject('originals/immutable.jpg'))).toEqual(source.bytes);
  });

  it('detects stale remote metadata and checksum failures during processing, and cleans scratch on failure', async () => {
    await remoteMode(); const source = await staged();
    await storeFile('originals/check.jpg', source.file, source.info);
    mock.headSize = 0;
    await expect(objectStat('originals/check.jpg')).rejects.toMatchObject({ code: 'integrity' });
    mock.headSize = null; mock.corruptGet = true;
    await expect(materializeObject('originals/check.jpg')).rejects.toMatchObject({ code: 'integrity' });
    expect((await fs.readdir(storage.abs('tmp'))).filter((n) => n.startsWith('materialized-'))).toEqual([]);
    mock.corruptGet = false;
    const copy = await materializeObject('originals/check.jpg'); await copy.release();
  });

  it('only deletes the recorded target/version and leaves inventory retryable on remote failure', async () => {
    await remoteMode('mirror'); const source = await staged();
    await storeFile('originals/delete.jpg', source.file, source.info);
    const row = db.select().from(schema.storageObjects).get()!;
    mock.failure = 'DeleteObjectCommand';
    await expect(deleteObject(row.storagePath)).rejects.toMatchObject({ code: 'remote_unavailable' });
    expect(db.select().from(schema.storageObjects).get()).toBeDefined();
    expect(await fs.readFile(storage.abs(row.storagePath))).toEqual(source.bytes);
    mock.failure = ''; vi.stubEnv('B2_BUCKET', 'another-photo-bucket');
    await deleteObject(row.storagePath);
    expect(mock.calls.at(-1)!.input).toMatchObject({ Bucket: row.remoteBucket, Key: row.remoteKey, VersionId: row.remoteVersion });
    expect(db.select().from(schema.storageObjects).all()).toHaveLength(0);
    await expect(fs.stat(storage.abs(row.storagePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails gracefully on low disk and expires old tests', async () => {
    vi.stubEnv('STORAGE_MIN_FREE_BYTES', String(Number.MAX_SAFE_INTEGER));
    await expect(assertScratchSpace(100)).rejects.toMatchObject({ code: 'disk_full' });
    await testStorageConnection();
    const setting = db.select().from(schema.settings).where(eq(schema.settings.key, 'storage.test')).get()!;
    const saved = setting.value as { v: { at: string; fingerprint: string } };
    db.update(schema.settings).set({ value: { v: { ...saved.v, at: '2000-01-01T00:00:00.000Z' } } }).where(eq(schema.settings.key, 'storage.test')).run();
    expect((await storageStatus()).testedAt).toBeNull();
    await expect(setStorageMode('b2')).rejects.toMatchObject({ code: 'not_tested' });
    await setStorageMode('local');
  });

  it('blocks uploads to edited untested targets but keeps approved configurations working beyond the test window', async () => {
    await remoteMode();
    const source = await staged();
    vi.stubEnv('B2_BUCKET', 'another-photo-bucket');
    await expect(storeFile('originals/blocked.jpg', source.file, source.info)).rejects.toMatchObject({ code: 'not_tested' });
    expect(mock.calls).toHaveLength(0);
    expect(await fs.readFile(source.file)).toEqual(source.bytes);
    vi.stubEnv('B2_BUCKET', 'private-photo-fixture');
    db.delete(schema.settings).where(eq(schema.settings.key, 'storage.test')).run();
    await storeFile('originals/approved.jpg', source.file, source.info);
    expect(await objectStat('originals/approved.jpg')).toMatchObject({ size: source.bytes.length });
  });

  it('rejects malformed range responses and closes requests canceled before any read', async () => {
    await remoteMode(); const source = await staged();
    await storeFile('originals/ranges.jpg', source.file, source.info);
    mock.badRange = true;
    await expect(openObject('originals/ranges.jpg', { start: 1, end: 3 })).rejects.toMatchObject({ code: 'invalid_range' });
    expect(mock.streams.at(-1)?.destroyed).toBe(true);
    mock.badRange = false;
    const stream = await openObject('originals/ranges.jpg');
    const closed = new Promise<void>((resolve) => stream.once('close', resolve));
    const before = mock.destroyedClients;
    stream.destroy(); await closed;
    expect(mock.streams.at(-1)?.destroyed).toBe(true);
    expect(mock.destroyedClients).toBeGreaterThan(before);
  });

  it('does not approve a connection when HEAD is unavailable and removes its test object', async () => {
    mock.failure = 'HeadObjectCommand';
    await expect(testStorageConnection()).rejects.toMatchObject({ code: 'remote_unavailable' });
    expect((await storageStatus()).testedAt).toBeNull();
    expect(mock.files.size).toBe(0);
  });
});
