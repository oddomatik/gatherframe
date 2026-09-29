import { error, type RequestHandler } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db, schema } from '$server/db';
import { coverImage, isCoverKind, COVER_RECIPE } from '$server/cover-images';
import { validMediaToken, type MediaKind } from '$server/media-access';
import { storage } from '$server/storage';
import { objectStat, openObject } from '$server/blob-store';

const KINDS = new Set(['thumb', 'preview', 'web', 'cover640', 'cover960', 'cover1440']);

export const GET: RequestHandler = async (e) => {
  const kind = e.params.kind as MediaKind;
  if (!KINDS.has(kind)) throw error(404, 'Not found');
  const photoId = Number(e.params.photoId);
  const row = db.select({ eventId: schema.galleries.eventId, status: schema.photos.renditionStatus, hash: schema.photos.renditionHash }).from(schema.photos).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId)).where(eq(schema.photos.id, photoId)).get();
  if (!row) throw error(404, 'Not found');
  const event = db.select().from(schema.events).where(eq(schema.events.id, row.eventId)).get();
  if (!event) throw error(404, 'Not found');
  // Demo startup validates an isolated public fixture; its studio tour has no login cookie.
  const admin = e.locals.demo === true || (!!e.locals.admin && e.cookies.get('pk_parent_preview') !== '1');
  if (!admin && !validMediaToken(e.url.searchParams.get('t'), event, photoId, kind)) throw error(403, 'Open the shared gallery to view this preview');
  if (row.status !== 'ready') throw error(404, 'Not ready');
  const cover = isCoverKind(kind);
  const key = storage.derivative(row.eventId, photoId, cover ? 'web' : kind as 'thumb' | 'preview' | 'web', row.hash ?? undefined);
  const versioned = !!row.hash?.startsWith('v2-');
  const etag = versioned ? `"${photoId}-${kind}-${row.hash}${cover ? `-${COVER_RECIPE}` : ''}"` : null;
  // Only immutable, current owner URLs may skip revalidation. Vary prevents
  // an owner response being reused after logout or while previewing as parent.
  // Parent images may cache bytes, but every reuse checks the capability first.
  const cache = versioned
    ? admin && e.url.searchParams.get('v') === row.hash ? 'private, max-age=3600, immutable' : 'private, no-cache'
    : 'private, no-store';
  const headers = new Headers({ 'content-type': 'image/webp', 'cache-control': cache, vary: 'Cookie', 'content-disposition': `inline; filename="preview-only-${photoId}.webp"` });
  if (etag) {
    headers.set('etag', etag);
    const matches = e.request.headers.get('if-none-match')?.split(',').some(value => {
      const tag = value.trim().replace(/^W\//, '');
      return tag === '*' || tag === etag;
    });
    // Access checks above are deliberately before this fast path. No B2 HEAD
    // or image-body read is needed when the browser already has these bytes.
    if (matches) return new Response(null, { status: 304, headers });
  }

  if (isCoverKind(kind)) {
    let bytes: Buffer;
    try { bytes = await coverImage(key, kind, versioned); }
    catch { throw error(404, 'Not ready'); }
    headers.set('content-length', String(bytes.length));
    return new Response(e.request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
  }

  let size: number;
  try { size = (await objectStat(key)).size; } catch { throw error(404, 'Not ready'); }
  headers.set('content-length', String(size));
  if (e.request.method === 'HEAD' || !size) return new Response(null, { headers });
  let stream;
  try { stream = await openObject(key); } catch { throw error(404, 'Not ready'); }
  const abort = () => { stream.destroy(); };
  e.request.signal.addEventListener('abort', abort, { once: true });
  stream.once('close', () => e.request.signal.removeEventListener('abort', abort));
  if (e.request.signal.aborted) stream.destroy();
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { headers });
};

export const HEAD = GET;
