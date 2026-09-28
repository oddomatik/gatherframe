import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { visiblePhoto } from '$server/media-access';
import { requireEventAccess } from '$server/guard';
import { db, schema } from '$server/db';
import { env, nowIso } from '$server/env';
import { randomToken } from '$server/ids';
import { getSettings } from '$server/settings';
import { validateZipEntries, ZipError } from '$server/zip';
import { rateLimit } from '$server/ratelimit';

const Body = z.object({ photoIds: z.array(z.number().int().positive()).min(1).max(env.maxZipPhotos), roles: z.array(z.enum(['social', 'print', 'raw'])).min(1) });

export const POST: RequestHandler = async (e) => {
  const { event, sid } = requireEventAccess(e);
  if (!rateLimit(`zip:${sid}`, 30, 600_000).ok) throw error(429, 'Too many downloads started. Try again in a few minutes.');
  const parsed = Body.safeParse(await e.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Bad request');
  const roles = parsed.data.roles.filter((r) => event.variantPolicy[r] === 'free');
  if (!roles.length) throw error(400, 'Those versions are not available for download');
  // Photos must belong to this event; the payload only stores ids that passed.
  const owned = db.select({ id: schema.photos.id }).from(schema.photos).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(and(inArray(schema.photos.id, parsed.data.photoIds), eq(schema.galleries.eventId, event.id))).all().map((r) => r.id).filter((id) => visiblePhoto(id, event.id));
  if (owned.length !== new Set(parsed.data.photoIds).size) throw error(409, 'Some selected photos are no longer available. Your selection has been kept; please review it.');
  if (!owned.length) throw error(400, 'No photos found');
  const files = db.select({ n: schema.photoFiles.id, photoId: schema.photoFiles.photoId, path: schema.photoFiles.storagePath, bytes: schema.photoFiles.bytes, sha256: schema.photoFiles.sha256 }).from(schema.photoFiles).where(and(inArray(schema.photoFiles.photoId, owned), inArray(schema.photoFiles.role, roles), eq(schema.photoFiles.downloadable, 1))).all();
  const availableIds = new Set(files.map((f) => f.photoId));
  if (owned.some((id) => !availableIds.has(id))) throw error(409, 'A selected photo has no file in these versions yet. Your selection has been kept; choose another version or remove that photo.');
  try { await validateZipEntries(files.map((f) => ({ storagePath: f.path, name: `photo-${f.photoId}`, expectedBytes: f.bytes, expectedSha256: f.sha256 })), getSettings().zipStreamMaxBytes); }
  catch (err) { if (err instanceof ZipError) throw error(err.status, err.message); throw err; }
  const token = randomToken(24);
  db.insert(schema.downloadTokens).values({ token, eventId: event.id, visitorSid: sid, payload: { photoIds: owned, roles }, usesLeft: 5, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: nowIso() }).run();
  return json({ url: `/g/${event.slug}/dl/${token}`, files: files.length });
};
