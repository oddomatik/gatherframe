import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentHeader, entryNamer, safeSegment, releaseOnce, validateZipEntries, zipStream } from './zip';
import { Readable } from 'node:stream';
import { objectStat, openObject } from './blob-store';

vi.mock('./blob-store', () => ({ objectStat: vi.fn(), openObject: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

describe('zip naming', () => {
  it('sanitizes separators and control characters', () => {
    expect(safeSegment('Emma/R:*?"<>|\u0001')).toBe('Emma_R________');
    expect(safeSegment('..')).toBe('_');
    expect(safeSegment('   ')).toBe('file');
  });
  it('dedupes collisions with -2/-3 suffixes, case-insensitively', () => {
    const name = entryNamer();
    expect(name('Emma R', 'img_0001.jpg')).toBe('Emma R/img_0001.jpg');
    expect(name('Emma R', 'IMG_0001.JPG')).toBe('Emma R/IMG_0001-2.JPG');
    expect(name('Emma R', 'img_0001.jpg')).toBe('Emma R/img_0001-3.jpg');
  });
  it('emits RFC 5987 filename* with an ASCII fallback', () => {
    expect(attachmentHeader('José – 3 photos.zip')).toBe(`attachment; filename="Jos_ _ 3 photos.zip"; filename*=UTF-8''Jos%C3%A9%20%E2%80%93%203%20photos.zip`);
  });
});


import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fixtureDir: string;
beforeAll(async () => { fixtureDir = await mkdtemp(path.join(tmpdir(), 'picture-day-zip-')); await writeFile(path.join(fixtureDir, 'photo.jpg'), 'synthetic photo bytes'); });
afterAll(async () => { await rm(fixtureDir, { recursive: true, force: true }); });

describe('real archive lifecycle', () => {
  it('releases one slot for a real archive even when both end and close fire', async () => {
    let active = 4;
    const done = releaseOnce(() => { active--; });
    const stream = await zipStream([{ absPath: path.join(fixtureDir, 'photo.jpg'), name: 'Photos/Photo-1.jpg' }]);
    stream.once('end', done); stream.once('close', done); stream.once('error', done);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(active).toBe(3);
    const archive = Buffer.concat(chunks);
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect(archive.includes(Buffer.from('Photos/Photo-1.jpg'))).toBe(true);
    expect(archive.includes(Buffer.from('synthetic photo bytes'))).toBe(true);
  });

  it('rejects missing files and oversized bundles before creating the stream', async () => {
    await expect(zipStream([{ absPath: path.join(fixtureDir, 'missing.jpg'), name: 'missing.jpg' }])).rejects.toThrow('not available');
    await expect(validateZipEntries([{ absPath: path.join(fixtureDir, 'photo.jpg'), name: 'photo.jpg' }], 3)).rejects.toThrow('fewer photos');
  });

  it('releases an aborted archive exactly once', async () => {
    let released = 0;
    const controller = new AbortController();
    const stream = await zipStream([{ absPath: path.join(fixtureDir, 'photo.jpg'), name: 'photo.jpg' }], controller.signal);
    const done = releaseOnce(() => { released++; });
    const finished = new Promise<void>((resolve) => stream.once('close', resolve));
    stream.once('end', done); stream.once('close', done); stream.once('error', done);
    controller.abort();
    await finished;
    expect(released).toBe(1);
  });
});

describe('remote archive delivery', () => {
  it('preflights object sizes and integrity before opening any response bodies', async () => {
    vi.mocked(objectStat).mockResolvedValue({ size: 8, sha256: 'expected' });
    await expect(zipStream([{ storagePath: 'originals/a', name: 'a.jpg', expectedBytes: 9 }])).rejects.toThrow('not available');
    await expect(zipStream([{ storagePath: 'originals/a', name: 'a.jpg', expectedSha256: 'changed' }])).rejects.toThrow('not available');
    await expect(zipStream([{ storagePath: 'originals/a', name: 'a.jpg' }], undefined, 7)).rejects.toThrow('fewer photos');
    expect(openObject).not.toHaveBeenCalled();
  });

  it('streams remote files and job-ticket text with at most one source open', async () => {
    let active = 0, peak = 0;
    vi.mocked(objectStat).mockResolvedValue({ size: 8 });
    vi.mocked(openObject).mockImplementation(async (key) => {
      active++; peak = Math.max(peak, active);
      const source = Readable.from([Buffer.from(`${key} bytes`)]);
      source.once('end', () => { active--; });
      return source;
    });
    const stream = await zipStream([
      { storagePath: 'originals/one', name: 'Photos/one.jpg' },
      { storagePath: 'originals/two', name: 'Photos/two.jpg' },
      { content: 'Print these approved photos', name: 'pick-list.txt' }
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(peak).toBe(1);
    expect(active).toBe(0);
    expect(bytes.includes(Buffer.from('originals/one bytes'))).toBe(true);
    expect(bytes.includes(Buffer.from('originals/two bytes'))).toBe(true);
    expect(bytes.includes(Buffer.from('Print these approved photos'))).toBe(true);
  });

  it('fails the download when a remote body fails instead of silently skipping a photo', async () => {
    vi.mocked(objectStat).mockResolvedValue({ size: 8 });
    vi.mocked(openObject).mockResolvedValue(Readable.from((async function* () {
      yield Buffer.from('partial');
      throw new Error('remote connection interrupted');
    })()));
    const stream = await zipStream([{ storagePath: 'originals/one', name: 'one.jpg' }]);
    await expect((async () => { for await (const _ of stream) { /* drain archive */ } })()).rejects.toThrow('remote connection interrupted');
  });

  it('closes the active remote response when the client cancels and never opens later files', async () => {
    vi.mocked(objectStat).mockResolvedValue({ size: 8 });
    const source = new Readable({ read() { this.push(Buffer.alloc(65536)); } });
    vi.mocked(openObject).mockResolvedValue(source);
    const controller = new AbortController();
    const stream = await zipStream([
      { storagePath: 'originals/one', name: 'one.jpg' },
      { storagePath: 'originals/two', name: 'two.jpg' }
    ], controller.signal);
    const closed = new Promise<void>((resolve) => stream.once('close', resolve));
    stream.once('error', () => {});
    stream.once('data', () => controller.abort());
    await closed;
    expect(source.destroyed).toBe(true);
    expect(openObject).toHaveBeenCalledTimes(1);
  });

  it('handles a request cancelled during preflight before opening a remote body', async () => {
    vi.mocked(objectStat).mockResolvedValue({ size: 8 });
    const controller = new AbortController();
    controller.abort();
    const stream = await zipStream([{ storagePath: 'originals/one', name: 'one.jpg' }], controller.signal);
    await expect((async () => { for await (const _ of stream) { /* drain archive */ } })()).rejects.toThrow('Download cancelled');
    expect(openObject).not.toHaveBeenCalled();
  });
});
