import { error } from '@sveltejs/kit';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { Event } from './db/schema';
import { sqlite } from './db';
import { getEvent, updateEvent } from './events';
import { env } from './env';
import { storage, withStorageLock } from './storage';
import { assertScratchSpace, materializeObject, storeFile } from './blob-store';

export const SHARE_UPLOAD_LIMIT = 10 * 1024 * 1024;
const WIDTH = 1200, HEIGHT = 630;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const uploadPath = (eventId: number, hash: string) => `sharing/${eventId}/${hash}.jpg`;
export function sharePhoto(eventId: number, photoId: number) {
  return sqlite.prepare(`SELECT p.id, p.rendition_hash hash FROM photos p
    JOIN galleries owner ON owner.id=p.gallery_id WHERE p.id=? AND owner.event_id=?
    AND p.rendition_status='ready' AND EXISTS (
      SELECT 1 FROM gallery_photos gp JOIN galleries g ON g.id=gp.gallery_id
      WHERE gp.photo_id=p.id AND g.event_id=? AND g.is_archived=0 AND g.is_intake=0
    )`).get(photoId, eventId, eventId) as { id: number; hash: string | null } | undefined;
}

/** This is a deliberately chosen public promo image, never an arbitrary first child. */
export function linkPreview(event: Event) {
  const photo = event.sharePhotoId ? sharePhoto(event.id, event.sharePhotoId) : undefined;
  const upload = /^[a-f0-9]{64}$/.test(event.shareUploadHash ?? '') ? event.shareUploadHash : null;
  const kind = upload ? 'upload' : photo ? 'photo' : 'title';
  // A replaced photo gets a new preview URL; changes to publication do not bypass access checks.
  const revision = digest(JSON.stringify(['link-preview-v1', event.id, event.name, kind, upload, photo?.id, photo?.hash])).slice(0, 24);
  const imagePath = `/share/${event.slug}/${revision}.jpg`;
  return { kind, revision, title: event.name, description: event.orderingEnabled ? 'Browse photos and order prints.' : 'Browse the photo album.',
    imageUrl: env.publicOrigin + imagePath, imagePath,
    shareUrl: `${env.publicOrigin}/g/${event.slug}?share=${revision}`,
    adminImageUrl: `/admin/api/events/${event.id}/share-image?v=${revision}`,
    source: upload ? uploadPath(event.id, upload) : photo ? storage.derivative(event.id, photo.id, 'preview', photo.hash) : null,
    width: WIDTH, height: HEIGHT, alt: kind === 'title' ? event.name : `Link preview for ${event.name}` };
}

export function publicLinkPreview(event: Event) {
  const { source: _source, adminImageUrl: _admin, ...preview } = linkPreview(event);
  return preview;
}

/** Do not allow an unlimited multipart body just because full photo uploads are unlimited. */
export async function readShareForm(request: Request): Promise<FormData> {
  const max = SHARE_UPLOAD_LIMIT + 64 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw error(413, 'Use an image smaller than 10 MB.');
  if (!request.body) throw error(400, 'Choose a preview.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw error(413, 'Use an image smaller than 10 MB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '' }, body: Buffer.concat(chunks) }).formData();
}

export async function saveLinkPreview(eventId: number, form: FormData) {
  if (!getEvent(eventId)) throw error(404, 'Project not found.');
  const mode = form.get('mode');
  if (mode === 'title') { updateEvent(eventId, { sharePhotoId: null, shareUploadHash: null }); return; }
  if (mode === 'photo') {
    const id = Number(form.get('photoId'));
    if (!Number.isSafeInteger(id) || !sharePhoto(eventId, id)) throw error(400, 'Choose a ready photo in an active collection in this project.');
    updateEvent(eventId, { sharePhotoId: id, shareUploadHash: null }); return;
  }
  if (mode !== 'upload') throw error(400, 'Choose a preview type.');
  const file = form.get('image');
  if (!file || typeof file === 'string' || !file.size) throw error(400, 'Choose a JPEG, PNG or WebP image.');
  if (file.size > SHARE_UPLOAD_LIMIT) throw error(413, 'Use an image smaller than 10 MB.');
  await assertScratchSpace(file.size * 2);
  let bytes: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw Error('Unsupported image');
    // Rasterize, orient and strip EXIF/private metadata; fit rather than cutting off faces or artwork.
    bytes = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize(WIDTH, HEIGHT, { fit: 'contain', background: '#f5f2eb' }).flatten({ background: '#f5f2eb' }).jpeg({ quality: 88 }).toBuffer();
  } catch { throw error(400, 'Choose a valid, non-animated JPEG, PNG or WebP image under 40 megapixels.'); }
  const hash = digest(bytes), rel = uploadPath(eventId, hash);
  const temp = storage.abs(storage.tmp(`share-${randomBytes(16).toString('hex')}.jpg`));
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    await withStorageLock(rel, () => storeFile(rel, temp, { sha256: hash, bytes: bytes.length, mime: 'image/jpeg' }));
    updateEvent(eventId, { sharePhotoId: null, shareUploadHash: hash });
  } finally { await fs.rm(temp, { force: true }); }
}

const xml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
function titleSvg(title: string) {
  // Bound lines and escape owner text before it enters SVG. No external resources.
  const chars = Array.from(title.replace(/[\u0000-\u001f]/g, ' ').trim()).slice(0, 150);
  const lines: string[] = [];
  while (chars.length && lines.length < 4) {
    let count = Math.min(28, chars.length);
    if (chars.length > count) { const space = chars.slice(0, count).lastIndexOf(' '); if (space > 12) count = space; }
    lines.push(chars.splice(0, count).join('').trim()); while (chars[0] === ' ') chars.shift();
  }
  if (chars.length) lines[3] = lines[3].slice(0, 26) + '…';
  const widest = Math.max(1, ...lines.map(line => Array.from(line).reduce((sum, c) => sum + (/[MW@]|[^\u0000-\u007f]/.test(c) ? 1 : /[A-Z]/.test(c) ? 0.8 : 0.65), 0)));
  const fontSize = Math.min(62, Math.floor(940 / widest));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f5f2eb"/><rect x="64" y="64" width="1072" height="502" rx="24" fill="#ffffff"/><text x="600" y="${315 - (lines.length - 1) * 40}" font-family="DejaVu Sans,sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="middle" fill="#243c36">${lines.map((line, i) => `<tspan x="600" dy="${i ? 80 : 0}">${xml(line)}</tspan>`).join('')}</text></svg>`);
}

// Bounded process cache; authorization/current revision is checked by each handler before use.
const cards = new Map<string, Buffer>();
export async function renderLinkPreview(event: Event) {
  const preview = linkPreview(event), cached = cards.get(preview.revision);
  if (cached) return cached;
  let bytes: Buffer;
  if (preview.source) {
    const source = await materializeObject(preview.source);
    try { bytes = await sharp(source.path).rotate().resize(WIDTH, HEIGHT, { fit: 'contain', background: '#f5f2eb' }).flatten({ background: '#f5f2eb' }).jpeg({ quality: 88 }).toBuffer(); }
    finally { await source.release(); }
  } else bytes = await sharp(titleSvg(event.name)).jpeg({ quality: 88 }).toBuffer();
  if (cards.size >= 16) cards.delete(cards.keys().next().value!);
  cards.set(preview.revision, bytes);
  return bytes;
}

export async function linkPreviewResponse(event: Event, request: Request) {
  const bytes = await renderLinkPreview(event);
  const etag = `"${digest(bytes)}"`;
  const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, no-cache', 'x-robots-tag': 'noindex, nofollow', etag, vary: 'Cookie' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: { ...headers, 'content-length': String(bytes.length) } });
}
