import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';

// Actual services + actual migrated SQLite, with disposable bytes and no external transports.
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { env: { dataDir: mkdtempSync(join(tmpdir(), 'picture-day-reliability-')), secret: 'synthetic-test-secret-not-live', publicOrigin: 'https://fixture.invalid', maxUploadBytes: 1e7, allowPrivateNotify: false }, nowIso: () => new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
vi.mock('./mail', () => ({ sendMail: vi.fn(async () => 'synthetic-message') }));
vi.mock('./guard', () => ({ requireEventAccess: () => ({ event: db.select().from(schema.events).get()!, sid: 'synthetic-visitor' }) }));
vi.mock('./settings', async () => {
  const actual = await vi.importActual<typeof import('./settings')>('./settings');
  return { ...actual, getSettings: vi.fn(() => ({ ...actual.DEFAULT_SETTINGS, smtp: { host: 'fixture.invalid', port: 587, secure: false, user: '', pass: '', from: 'photos@fixture.invalid' }, adminEmail: 'original@fixture.invalid', notifyGotify: false, notifyWebhook: false })) };
});

import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { storage } from './storage';
import { ingestUpload, deletePhotoFile } from './ingest';
import { renderPhoto, shutdownImages } from './images';
import { deleteUnreferencedPath } from './workers';
import { deliverPending, emitDomainEvent, parentText, type OrderNotification } from './notify';
import { sendMail } from './mail';
import { getSettings } from './settings';
import { printReadiness } from './production';
import { approvePrintMasters } from './production-approval';
import { GET as fileGET, HEAD as fileHEAD } from '../../routes/g/[slug]/file/[fileId]/+server';

let eventId: number, galleryId: number;
const data: OrderNotification = { orderId: 1, orderNumber: 'FIXTURE-1', eventName: 'Happy Day', subjectName: null, customerName: 'Parent', email: null, phone: null, totalCents: 100, currency: 'USD', status: 'new', lines: [], adminUrl: '', statusUrl: '', venmoUrl: null, paymentInstructions: '', notes: null };

beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of ['storage_objects', 'download_log', 'notification_deliveries', 'jobs', 'order_events', 'order_item_cells', 'order_item_sheets', 'order_items', 'payments', 'orders', 'photo_files', 'photos', 'galleries', 'events']) sqlite.exec(`DELETE FROM ${table}`);
  await fs.mkdir(storage.abs('tmp'), { recursive: true });
  eventId = db.insert(schema.events).values({ slug: 'fixture', name: 'Fixture', variantPolicy: { social: 'free', print: 'free', raw: 'disabled' }, createdAt: nowIso(), updatedAt: nowIso() }).returning().get().id;
  galleryId = db.insert(schema.galleries).values({ eventId, publicId: 'fixture-gallery', name: 'PRIVATE LABEL', createdAt: nowIso() }).returning().get().id;
});

afterAll(async () => { await shutdownImages(); sqlite.close(); await fs.rm(env.dataDir, { recursive: true, force: true }); });

async function jpeg(color = '#ffccaa') { return sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).jpeg().toBuffer(); }
async function upload(buffer: Buffer, extra: Partial<Parameters<typeof ingestUpload>[0]> = {}) {
  return ingestUpload({ eventId, galleryId, filename: 'picture.jpg', role: 'print', body: Readable.toWeb(Readable.from([buffer])) as ReadableStream<Uint8Array>, declaredBytes: buffer.length, ...extra });
}

describe('durable photo ingestion and versioned rendering', () => {
  it('does not publish metadata if durable file install fails, and a retry repairs missing stored bytes', async () => {
    const buffer = await jpeg();
    const fail = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(upload(buffer)).rejects.toThrow('synthetic disk failure');
    fail.mockRestore();
    expect(db.select().from(schema.photoFiles).all()).toHaveLength(0);
    expect(db.select().from(schema.photos).all()).toHaveLength(0);
    const first = await upload(buffer);
    const file = db.select().from(schema.photoFiles).get()!;
    await fs.unlink(storage.abs(file.storagePath));
    expect((await upload(buffer)).status).toBe('unchanged');
    expect(await fs.readFile(storage.abs(file.storagePath))).toEqual(buffer);
    expect(db.select().from(schema.galleryPhotos).all()).toEqual([{ galleryId, photoId: first.photoId }]);
    expect(db.select().from(schema.jobs).all()).toHaveLength(1);
  });

  it('requires an explicit replacement; keeps both with a new stem; retains ordered versions', async () => {
    const firstBytes = await jpeg();
    const otherBytes = await jpeg('#5599ff');
    await upload(firstBytes);
    const original = db.select().from(schema.photoFiles).get()!;
    await expect(upload(otherBytes)).rejects.toMatchObject({ status: 409 });
    expect(db.select().from(schema.photoFiles).get()!.sha256).toBe(original.sha256);
    expect((await upload(otherBytes, { replacement: 'replace' })).status).toBe('replaced');
    expect((await upload(await jpeg('#aa33bb'), { stemOverride: 'picture-2' })).status).toBe('created');
    expect((await upload(otherBytes)).status).toBe('unchanged');
    await expect(upload(firstBytes)).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(storage.abs(original.storagePath))).toEqual(firstBytes);
    expect(db.select().from(schema.photos).all()).toHaveLength(2);
  });

  it('pairs later variants through collection membership without duplicating the storage anchor', async () => {
    const original = await upload(await jpeg(), { role: 'social', stemOverride: 'picture~folder-fixture' });
    const child = db.insert(schema.galleries).values({ eventId, publicId: 'child-collection', name: 'Child', createdAt: nowIso() }).returning().get();
    db.insert(schema.galleryPhotos).values({ galleryId: child.id, photoId: original.photoId }).run();
    db.delete(schema.galleryPhotos).where(eq(schema.galleryPhotos.galleryId, galleryId)).run();
    const print = await upload(await jpeg('#445566'), { galleryId: child.id });
    expect(print.photoId).toBe(original.photoId);
    expect(print.stem).toBe('picture~folder-fixture');
    expect(db.select().from(schema.photos).all()).toHaveLength(1);
    expect(db.select().from(schema.photos).get()!.galleryId).toBe(galleryId);
    await expect(upload(await jpeg('#778899'), { stemOverride: 'picture~folder-fixture' })).rejects.toMatchObject({ status: 409 });
  });

  it('a delayed deletion never removes the object used by a reupload', async () => {
    const buffer = await jpeg();
    const first = await upload(buffer);
    const rel = db.select().from(schema.photoFiles).get()!.storagePath;
    await deletePhotoFile(first.fileId);
    await upload(buffer);
    expect(await deleteUnreferencedPath(rel)).toBe(false);
    expect(await fs.readFile(storage.abs(rel))).toEqual(buffer);
  });

  it('fences an older render after a source replacement and publishes a complete new rendition set', async () => {
    const first = await upload(await jpeg());
    const nextBytes = await jpeg('#00ff22');
    const oldRender = renderPhoto(first.photoId);
    // Direct source metadata change while old render is awaiting image work.
    db.update(schema.photoFiles).set({ sha256: 'f'.repeat(64) }).where(eq(schema.photoFiles.id, first.fileId)).run();
    await oldRender;
    expect(db.select().from(schema.photos).get()!.renditionStatus).toBe('pending');
    await upload(nextBytes, { replacement: 'replace' });
    await Promise.all([renderPhoto(first.photoId), renderPhoto(first.photoId)]);
    const photo = db.select().from(schema.photos).get()!;
    const file = db.select().from(schema.photoFiles).get()!;
    expect(photo.renditionStatus).toBe('ready');
    expect(photo.renditionHash).toContain(file.sha256);
    for (const kind of ['thumb', 'preview', 'web'] as const) expect((await fs.stat(storage.abs(storage.derivative(eventId, photo.id, kind, photo.renditionHash)))).size).toBeGreaterThan(0);
  });
});

describe('notification outbox', () => {
  it('never includes private filenames in legacy or newly queued parent receipts', () => {
    const privatePayload = { ...data, lines: ['Private child name, file and photographer note'] };
    const legacy = parentText(privatePayload, 'order.created', 'Studio', '');
    expect(legacy).not.toContain('Private child name');
    expect(legacy).toContain('order link');
    const current = parentText({ ...privatePayload, parentLines: ['1 × 8×10: Photo 7'] }, 'order.created', 'Studio', '');
    expect(current).toContain('Photo 7');
    expect(current).not.toContain('Private child name');
  });

  it('atomically claims concurrent delivery attempts and uses the saved recipient', async () => {
    emitDomainEvent('order.created', data);
    const settings = getSettings();
    vi.mocked(getSettings).mockReturnValueOnce({ ...settings, adminEmail: 'changed@fixture.invalid' });
    await Promise.all([deliverPending(), deliverPending()]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0][1].to).toBe('original@fixture.invalid');
    expect(db.select().from(schema.notificationDeliveries).get()).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('drains beyond the old batch limit, and queues a follow-up beyond its bounded batch', async () => {
    for (let n = 0; n < 105; n++) emitDomainEvent('order.created', data);
    await deliverPending();
    expect(sendMail).toHaveBeenCalledTimes(100);
    expect(db.select().from(schema.jobs).all()).toHaveLength(1);
    await deliverPending();
    expect(sendMail).toHaveBeenCalledTimes(105);
    expect(db.select().from(schema.notificationDeliveries).all().every((d) => d.status === 'sent')).toBe(true);
  });

  it('recovers an expired claim, retries transport failures, and preserves a stable message ID', async () => {
    emitDomainEvent('order.created', data);
    const delivery = db.select().from(schema.notificationDeliveries).get()!;
    db.update(schema.notificationDeliveries).set({ status: 'sending', nextAttemptAt: '2000-01-01T00:00:00.000Z' }).where(eq(schema.notificationDeliveries.id, delivery.id)).run();
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('synthetic offline'));
    await deliverPending();
    expect(db.select().from(schema.notificationDeliveries).get()).toMatchObject({ status: 'pending', attempts: 1 });
    db.update(schema.notificationDeliveries).set({ nextAttemptAt: '2000-01-01T00:00:00.000Z' }).where(eq(schema.notificationDeliveries.id, delivery.id)).run();
    await deliverPending();
    expect(db.select().from(schema.notificationDeliveries).get()).toMatchObject({ status: 'sent', attempts: 2 });
    expect(vi.mocked(sendMail).mock.calls[0][1].messageId).toBe(vi.mocked(sendMail).mock.calls[1][1].messageId);
  });
});

// Minimal detail fixture exercises production policy without unrelated pricing/checkout services.
function detail(photoId: number, printSha256: string | null): Parameters<typeof printReadiness>[0] {
  return { items: [{ sheets: [{ cells: [{ id: 10, photoId, photoStem: 'picture', printSha256 }] }] }] } as Parameters<typeof printReadiness>[0];
}

describe('production masters', () => {
  it('blocks social fallback, unapproved and changed masters, and missing disk bytes', async () => {
    const social = await upload(await jpeg(), { role: 'social' });
    expect((await printReadiness(detail(social.photoId, null))).conflicts[0].reason).toBe('missing_print');
    const master = await upload(await jpeg('#112233'));
    expect((await printReadiness(detail(master.photoId, null))).conflicts[0].reason).toBe('unapproved_print');
    expect((await printReadiness(detail(master.photoId, 'a'.repeat(64)))).conflicts[0].reason).toBe('changed_print');
    expect((await printReadiness(detail(master.photoId, master.sha256))).ready).toBe(true);
    const file = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.id, master.fileId)).get()!;
    await fs.unlink(storage.abs(file.storagePath));
    expect((await printReadiness(detail(master.photoId, master.sha256))).conflicts[0].reason).toBe('missing_file');
  });
});


describe('reviewed production approval', () => {
  it('rejects a stale second master without partial approval, then audits an exact approval', async () => {
    const first = await upload(await jpeg('#1144aa'));
    const second = await upload(await jpeg('#aa4411'), { stemOverride: 'picture-2' });
    const order = db.insert(schema.orders).values({ orderNumber: 'TEST-APPROVAL', accessToken: 'synthetic-order-token', idempotencyKey: 'test-approval-key', eventId, customerName: 'Parent', status: 'new', subtotalCents: 1000, totalCents: 1000, currency: 'USD', createdAt: nowIso(), updatedAt: nowIso() }).returning().get();
    const item = db.insert(schema.orderItems).values({ orderId: order.id, productCode: 'TEST', productName: 'Two prints', productKind: 'package', quantity: 1, unitPriceCents: 1000, totalCents: 1000 }).returning().get();
    const sheet = db.insert(schema.orderItemSheets).values({ orderItemId: item.id, sheetIndex: 0, templateCode: 'TEST', label: 'Two prints', paperWidthIn: 8, paperHeightIn: 10 }).returning().get();
    const cells = [first, second].map((photo, index) => db.insert(schema.orderItemCells).values({ orderItemSheetId: sheet.id, cellIndex: index, printSizeCode: '4x6', label: '4 × 6', wIn: 4, hIn: 6, xIn: 0, yIn: 0, photoId: photo.photoId, photoStem: photo.stem, galleryName: 'Private owner label', printSha256: null }).returning().get());
    await expect(approvePrintMasters(order.id, [{ cellId: cells[0].id, sha256: first.sha256 }, { cellId: cells[1].id, sha256: '0'.repeat(64) }], 'owner', 'Final edits')).rejects.toThrow('changed again');
    expect(db.select().from(schema.orderItemCells).all().map((c) => c.printSha256)).toEqual([null, null]);
    expect(db.select().from(schema.orderEvents).all()).toHaveLength(0);
    expect(await approvePrintMasters(order.id, [{ cellId: cells[0].id, sha256: first.sha256 }, { cellId: cells[1].id, sha256: second.sha256 }], 'owner', 'Final edits reviewed')).toBe(2);
    expect(db.select().from(schema.orderItemCells).all().map((c) => c.printSha256)).toEqual([first.sha256, second.sha256]);
    expect(db.select().from(schema.orderEvents).get()).toMatchObject({ type: 'print_masters_approved', actor: 'owner', data: { reason: 'Final edits reviewed' } });
    // The master still cannot be removed while this real order is unfinished.
    await expect(deletePhotoFile(first.fileId)).rejects.toMatchObject({ status: 409 });
  });
});


describe('actual file response and metadata-only HEAD', () => {
  it('streams correct suffix bytes, rejects an impossible range, and never logs HEAD', async () => {
    const bytes = await jpeg('#33cc44');
    const photo = await upload(bytes);
    await renderPhoto(photo.photoId);
    function request(method: string, headers: Record<string, string> = {}) {
      return { params: { fileId: String(photo.fileId) }, request: new Request(`https://fixture.invalid/g/fixture/file/${photo.fileId}`, { method, headers }), getClientAddress: () => '127.0.0.1' } as Parameters<typeof fileGET>[0];
    }
    const head = await fileHEAD(request('HEAD', { range: 'bytes=-10' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    expect(db.select().from(schema.downloadLog).all()).toHaveLength(0);
    const partial = await fileGET(request('GET', { range: 'bytes=-10' }));
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(-10));
    expect(partial.headers.get('content-range')).toBe(`bytes ${bytes.length - 10}-${bytes.length - 1}/${bytes.length}`);
    const invalid = await fileGET(request('GET', { range: `bytes=${bytes.length}-` }));
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    expect(await invalid.text()).toBe('');
    const replaced = await fileGET(request('GET', { range: 'bytes=-10', 'if-range': '"old-master"' }));
    expect(replaced.status).toBe(200);
    expect(Buffer.from(await replaced.arrayBuffer())).toEqual(bytes);
    expect(db.select().from(schema.downloadLog).all()).toHaveLength(2);
  });
});
