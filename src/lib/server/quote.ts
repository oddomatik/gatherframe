import { db, schema } from './db';
import { inArray } from 'drizzle-orm';
import { hmac, sha256, safeEqual } from './secrets-ids';
import type { Catalog } from '$shared/catalog';
import { priceCart, type CartItem } from '$shared/pricing';

/** Bind the reviewed cart, prices AND print contents to this visitor. */
export function quoteCart(eventId: number, sid: string | null, cart: CartItem[], catalog: Catalog) {
  const priced = priceCart(cart, catalog);
  const ids = new Set(cart.map((item) => item.productId));
  const products = catalog.products.filter((p) => ids.has(p.id));
  const templateCodes = new Set(products.flatMap((p) => p.sheets.map((s) => s.templateCode)));
  const templates = [...templateCodes].sort().map((code) => catalog.sheets[code]);
  const photoIds = [...new Set(cart.flatMap((i) => i.sheets.flatMap((s) => s.cells.map((c) => c.photoId).filter((id): id is number => id !== null))))].sort((a,b) => a-b);
  const photos = photoIds.length ? db.select({ id: schema.photos.id, hash: schema.photos.renditionHash, status: schema.photos.renditionStatus }).from(schema.photos).where(inArray(schema.photos.id, photoIds)).orderBy(schema.photos.id).all() : [];
  const masters = photoIds.length ? db.select({ photoId: schema.photoFiles.photoId, role: schema.photoFiles.role, sha: schema.photoFiles.sha256 }).from(schema.photoFiles).where(inArray(schema.photoFiles.photoId, photoIds)).orderBy(schema.photoFiles.photoId, schema.photoFiles.role).all() : [];
  const digest = sha256(JSON.stringify({ eventId, sid, cart, priced, products, templates, printSizes: catalog.printSizes, photos, masters }));
  return { ...priced, quoteToken: hmac(`quote:${digest}`) };
}
export function acceptedQuote(token: string | undefined, current: string): boolean {
  return !!token && safeEqual(token, current);
}
