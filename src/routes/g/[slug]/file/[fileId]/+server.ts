import { fileIsCurrent, deliveryFilename, versionFor, currentFile } from '$server/delivery';
import { trackDownload } from '$server/activity';
import { error, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { visiblePhoto } from '$server/media-access';
import { requireEventAccess } from '$server/guard';
import { db, schema } from '$server/db';
import { nowIso } from '$server/env';
import { objectStat, openObject } from '$server/blob-store';
import { attachmentHeader } from '$server/zip';
import { parseByteRange } from '$server/range';

export const GET: RequestHandler = async (e) => {
  const { event, sid } = requireEventAccess(e);
  const row = db.select({ f: schema.photoFiles, stem: schema.photos.stem, galleryId: schema.galleries.id, eventId: schema.galleries.eventId })
    .from(schema.photoFiles).innerJoin(schema.photos, eq(schema.photos.id, schema.photoFiles.photoId)).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(eq(schema.photoFiles.id, Number(e.params.fileId))).get();
  if (!row || row.eventId !== event.id || !visiblePhoto(row.f.photoId, event.id)) throw error(404, 'Not found');
  if (!row.f.downloadable || event.variantPolicy[row.f.role] !== 'free') throw error(403, 'This version is not available for download');
  if (!fileIsCurrent(row.f)) throw error(409, 'This version is being updated. Please try again shortly.');
  const assertStillAvailable = () => {
    const latestEvent = requireEventAccess(e).event, latest = currentFile(row.f.photoId, row.f.role);
    if (!latest || latest.id !== row.f.id || latest.sha256 !== row.f.sha256 || !latest.downloadable || !fileIsCurrent(latest) || latestEvent.variantPolicy[latest.role] !== 'free' || !visiblePhoto(latest.photoId, latestEvent.id)) throw error(409, 'This download changed. Please choose it again from the gallery.');
  };
  const filename = deliveryFilename(row.f, versionFor(event.id, row.f.role));
  let size: number;
  try {
    const info = await objectStat(row.f.storagePath);
    if (info.size !== row.f.bytes || (info.sha256 && info.sha256 !== row.f.sha256)) throw new Error('File incomplete');
    size = info.size;
  } catch { throw error(404, 'This file is temporarily unavailable. Please try again later.'); }
  assertStillAvailable();
  const etag = `"${row.f.sha256}"`;
  const headers: Record<string, string> = {
    'content-type': row.f.mime, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', etag,
    'content-disposition': attachmentHeader(filename)
  };
  // HEAD is metadata only: no stream, no range evaluation and no download-log entry.
  if (e.request.method === 'HEAD') return new Response(null, { status: 200, headers });
  // A resumed download must not splice a newly replaced photo into the old bytes.
  const ifRange = e.request.headers.get('if-range');
  const range = parseByteRange(ifRange && ifRange !== etag ? null : e.request.headers.get('range'), size);
  headers['content-length'] = String(range.length);
  if (range.contentRange) headers['content-range'] = range.contentRange;
  if (range.status === 416) return new Response(null, { status: 416, headers });
  let stream: Readable | null = null;
  if (size) {
    try { stream = await openObject(row.f.storagePath, { start: range.start, end: range.end }); }
    catch { throw error(404, 'This file is temporarily unavailable. Please try again later.'); }
  }
  try { assertStillAvailable(); db.insert(schema.downloadLog).values({ eventId: event.id, galleryId: row.galleryId, photoFileId: row.f.id, role: row.f.role, visitorSid: sid, ip: null, createdAt: nowIso() }).run(); }
  catch (err) { stream?.destroy(); throw err; }
  if (!stream) return new Response(null, { status: range.status, headers });
  trackDownload(e,event.id,sid,stream,{photoId:row.f.photoId,channel:range.status===206?'range':new URL(e.request.url).searchParams.get('via')==='phone'?'phone':'file',social:row.f.role==='social'?1:0,print:row.f.role==='print'?1:0,raw:row.f.role==='raw'?1:0,other:row.f.role.startsWith('v_')?1:0,bytes:size},range.status===200);
  const download = stream;
  const abort = () => download.destroy();
  e.request.signal.addEventListener('abort', abort, { once: true });
  download.once('close', () => e.request.signal.removeEventListener('abort', abort));
  if (e.request.signal.aborted) download.destroy();
  return new Response(Readable.toWeb(download) as unknown as ReadableStream, { status: range.status, headers });
};

export const HEAD = GET;
