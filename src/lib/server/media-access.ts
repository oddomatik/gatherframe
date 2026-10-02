import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import type { Event } from './db/schema';
import { hmac, safeEqual, sha256 } from './secrets-ids';
import { nowIso } from './env';
import { grantActive, grantById, grantScope, scopeAllowsPhoto } from './sharing';

export type MediaKind = 'thumb' | 'preview' | 'web' | 'cover640' | 'cover960' | 'cover1440';
interface MediaClaim { p: number; e: number; k: MediaKind; f: string; exp: number; o?: number; g?:number; gv?:number; }
const fingerprint = (event: Event) => sha256(`${event.sourceSlug ?? event.slug}:${event.passwordHash ?? ''}`).slice(0, 24);

/** A numeric id is not a gallery invitation. Only mint these after an access check. */
export function mediaUrl(event: Event, photoId: number, kind: MediaKind, hash?: string | null, orderId?: number): string {
  // Stable within an hour so rerendering a page does not bust every image URL.
  // Lifetime remains at most 24 hours; authorization is rechecked on each use.
  const expires = (Math.floor(Date.now() / 3600_000) + 24) * 3600_000;
  const claim: MediaClaim = { p: photoId, e: event.id, k: kind, f: fingerprint(event), exp: expires, ...(orderId ? { o: orderId } : {}), ...(event.guestGrant ? {g:event.guestGrant.id,gv:event.guestGrant.version} : {}) };
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `/media/${photoId}/${kind}?t=${body}.${hmac(`media:${body}`)}${hash ? `&v=${encodeURIComponent(hash)}` : ''}${kind.startsWith('cover') ? '&cv=1' : ''}`;
}

export function visiblePhoto(photoId: number, eventId: number): boolean {
  return !!db.select({ id: schema.photos.id }).from(schema.photos)
    .innerJoin(schema.galleryPhotos, eq(schema.galleryPhotos.photoId, schema.photos.id))
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.galleryPhotos.galleryId))
    .where(and(eq(schema.photos.id, photoId), eq(schema.galleries.eventId, eventId), eq(schema.galleries.isArchived, 0), eq(schema.galleries.isIntake, 0), eq(schema.photos.renditionStatus, 'ready'))).limit(1).get();
}

export function validMediaToken(token: string | null, event: Event, photoId: number, kind: MediaKind): boolean {
  if (!token || token.length > 1600) return false;
  const [body, signature, extra] = token.split('.');
  if (extra || !signature || !safeEqual(hmac(`media:${body}`), signature)) return false;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as MediaClaim;
    if (c.p !== photoId || c.e !== event.id || c.k !== kind || c.f !== fingerprint(event) || !Number.isFinite(c.exp) || c.exp <= Date.now()) return false;
    if (c.o) {
      // Receipt capabilities show only photographs in that order, never the rest of the event.
      if (kind !== 'thumb') return false;
      return !!db.select({ id: schema.orderItemCells.id }).from(schema.orderItemCells)
        .innerJoin(schema.orderItemSheets, eq(schema.orderItemSheets.id, schema.orderItemCells.orderItemSheetId))
        .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.orderItemSheets.orderItemId))
        .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
        .where(and(eq(schema.orders.id, c.o), eq(schema.orders.eventId, event.id), eq(schema.orderItemCells.photoId, photoId))).limit(1).get();
    }
    if(c.g) {
      const grant=grantById(c.g);
      if(!grantActive(grant)||grant.event_id!==event.id||grant.version!==c.gv||!scopeAllowsPhoto({...event,guestGrant:grantScope(grant)},photoId))return false;
    } else if(event.scopedSharingOnly)return false;
    return !!event.isPublished && (!event.expiresAt || event.expiresAt > nowIso()) && visiblePhoto(photoId, event.id);
  } catch { return false; }
}
