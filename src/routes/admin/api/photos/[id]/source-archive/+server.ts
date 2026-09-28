import { error, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { db, schema } from '$server/db';
import { getSettings } from '$server/settings';
import { sourceArchiveEntries } from '$server/source-archive';
import { attachmentHeader, releaseOnce, zipStream, ZipError } from '$server/zip';

let activeStreams = 0;
const MAX_STREAMS = 4;

/** Private editing archive. Parent gallery grants never authorize source sidecars. */
export const GET: RequestHandler = async (e) => {
  if (!e.locals.admin) throw error(401, 'Please sign in first');
  const photoId = Number(e.params.id);
  if (!Number.isSafeInteger(photoId) || photoId <= 0) throw error(404, 'Photo not found');
  const raw = db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.photoId, photoId), eq(schema.photoFiles.role, 'raw'))).get();
  if (!raw) throw error(409, 'Add the matching RAW file before downloading an editing archive.');
  const sidecars = db.select().from(schema.photoSidecars).where(eq(schema.photoSidecars.photoId, photoId)).all();
  const { filename, entries } = sourceArchiveEntries(raw, sidecars);
  if (activeStreams >= MAX_STREAMS) return new Response('Other downloads are in progress. Please try again in a moment.', { status: 503, headers: { 'retry-after': '20', 'cache-control': 'private, no-store' } });
  // Reserve before cloud preflight yields; cancellation and all stream outcomes release once.
  activeStreams++;
  const done = releaseOnce(() => { activeStreams = Math.max(0, activeStreams - 1); });
  let archive;
  try { archive = await zipStream(entries, e.request.signal, getSettings().zipStreamMaxBytes); }
  catch (err) { done(); if (err instanceof ZipError) throw error(err.status, err.message); throw err; }
  archive.once('end', done); archive.once('error', done); archive.once('close', done);
  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, { headers: {
    'content-type': 'application/zip', 'content-disposition': attachmentHeader(filename),
    'cache-control': 'private, no-store', 'x-accel-buffering': 'no', 'x-robots-tag': 'noindex, nofollow'
  } });
};
