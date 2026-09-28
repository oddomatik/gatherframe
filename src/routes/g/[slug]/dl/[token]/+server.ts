import { trackDownload } from '$server/activity';
import { error, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { visiblePhoto } from '$server/media-access';
import { requireEventAccess } from '$server/guard';
import { db, schema } from '$server/db';
import { getSettings } from '$server/settings';
import { nowIso } from '$server/env';
import { attachmentHeader, entryNamer, zipStream, releaseOnce, ZipError } from '$server/zip';
import { safeSegment } from '$server/zip';

let activeStreams = 0;
const MAX_STREAMS = 4;

export const GET: RequestHandler = async (e) => {
  const { event, sid } = requireEventAccess(e);
  const t = db.select().from(schema.downloadTokens).where(eq(schema.downloadTokens.token, String(e.params.token))).get();
  if (!t || t.eventId !== event.id || t.expiresAt < nowIso() || t.usesLeft <= 0) throw error(410, 'This download link has expired. Please start the download again.');
  // Bound to the visitor cookie; N uses because iOS Safari fetches attachments twice.
  if (t.visitorSid !== sid) throw error(403, 'This download link belongs to another device');
  if (activeStreams >= MAX_STREAMS) return new Response('The server is busy building other downloads. Please try again in a moment.', { status: 503, headers: { 'retry-after': '20' } });
  if (t.payload.roles.some((role) => event.variantPolicy[role] !== 'free') || t.payload.photoIds.some((id) => !visiblePhoto(id, event.id))) throw error(409, 'These downloads have changed. Please review your selection in the gallery.');

  const rows = db.select({
    photoId: schema.photoFiles.photoId, fileId: schema.photoFiles.id, role: schema.photoFiles.role, path: schema.photoFiles.storagePath, filename: schema.photoFiles.originalFilename, ext: schema.photoFiles.ext, bytes: schema.photoFiles.bytes, sha256: schema.photoFiles.sha256,
    galleryName: schema.galleries.name, galleryId: schema.galleries.id, stem: schema.photos.stem
  }).from(schema.photoFiles).innerJoin(schema.photos, eq(schema.photos.id, schema.photoFiles.photoId)).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(and(inArray(schema.photoFiles.photoId, t.payload.photoIds), inArray(schema.photoFiles.role, t.payload.roles), eq(schema.photoFiles.downloadable, 1), eq(schema.galleries.eventId, event.id)))
    .orderBy(schema.galleries.name, schema.photos.stem, schema.photoFiles.role).all();
  const availableIds = new Set(rows.map((r) => r.photoId));
  if (t.payload.photoIds.some((id) => !availableIds.has(id))) throw error(409, 'A selected photo is no longer downloadable. Please review your selection.');

  const name = entryNamer();
  const roleTag = (r: string) => (t.payload.roles.length > 1 ? `-${r}` : '');
  const entries = rows.map((r) => ({ storagePath: r.path, name: name('Photos', `photo-${r.photoId}${roleTag(r.role)}.${r.ext}`), expectedBytes: r.bytes, expectedSha256: r.sha256 }));
  const ac = new AbortController();
  const abort = () => ac.abort();
  e.request.signal.addEventListener('abort', abort, { once: true });
  if (e.request.signal.aborted) ac.abort();
  // Reserve before remote preflight yields, so concurrent HEAD requests cannot exceed the cap.
  activeStreams++;
  const done = releaseOnce(() => { activeStreams = Math.max(0, activeStreams - 1); e.request.signal.removeEventListener('abort', abort); });
  let stream;
  try { stream = await zipStream(entries, ac.signal, getSettings().zipStreamMaxBytes); } catch (err) { done(); if (err instanceof ZipError) throw error(err.status, err.message); throw err; }
  stream.once('end', done); stream.once('error', done); stream.once('close', done);
  try {
    const consumed = db.update(schema.downloadTokens).set({ usesLeft: sql`${schema.downloadTokens.usesLeft} - 1` }).where(and(eq(schema.downloadTokens.token, t.token), sql`${schema.downloadTokens.usesLeft} > 0`)).run();
    if (!consumed.changes) throw error(410, 'This download link has expired. Please start the download again.');
    const now = nowIso();
    db.insert(schema.downloadLog).values(rows.map((r) => ({ eventId: event.id, galleryId: r.galleryId, photoFileId: r.fileId, role: r.role, visitorSid: sid, ip: null, createdAt: now }))).run();
  } catch (err) { stream.destroy(); done(); throw err; }

  trackDownload(e,event.id,sid,stream,{channel:'zip',social:rows.filter(r=>r.role==='social').length,print:rows.filter(r=>r.role==='print').length,raw:rows.filter(r=>r.role==='raw').length,bytes:rows.reduce((n,r)=>n+r.bytes,0)});
  const photoCount = new Set(rows.map((r) => r.photoId)).size;
  const filename = `${safeSegment(event.name)} - ${photoCount} photo${photoCount === 1 ? '' : 's'}.zip`;
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: { 'content-type': 'application/zip', 'content-disposition': attachmentHeader(filename), 'cache-control': 'no-store', 'x-accel-buffering': 'no' }
  });
};
