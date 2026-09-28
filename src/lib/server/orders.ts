import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { orderSuffix, randomToken } from './ids';
import { eventCatalog } from './catalog';
import { emitDomainEvent, scheduleDeliveries, type OrderNotification } from './notify';
import { getSettings } from './settings';
import { type CartItem } from '$shared/pricing';
import { canTransition, type OrderStatus, type PaymentMethod } from '$shared/orders';
import { resolveCellGeometry } from '$shared/geometry';
import { buildVenmoLink } from '$shared/venmo';
import type { Event } from './db/schema';
import { sha256 } from './secrets-ids';
import { quoteCart, acceptedQuote } from './quote';
import { visiblePhoto } from './media-access';
import { PAYMENT_METHODS } from '$shared/orders';

export class OrderError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }

export interface CustomerInput { name: string; email?: string | null; phone?: string | null; subjectName?: string | null; notes?: string | null; photoRequests?: Record<string,string>; emailUpdates?: boolean; }

export function orderNumber(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `PO-${get('year')}${get('month')}${get('day')}-${orderSuffix()}`;
}

/** Validate, price server-side, snapshot everything, notify. Idempotent per (event, idempotencyKey). */
export function createOrder(input: { event: Event; cart: CartItem[]; customer: CustomerInput; quoteToken?: string; idempotencyKey: string; ip: string | null; sid: string | null }) {
  const { event } = input;
  const photoRequests = Object.fromEntries(Object.entries(input.customer.photoRequests ?? {}).filter(([,note])=>note.trim()).sort(([a],[b])=>Number(a)-Number(b)).map(([id,note])=>[id,note.trim()]));
  if (Object.keys(photoRequests).length > 200 || Object.values(photoRequests).join('').length > 20000 || Object.entries(photoRequests).some(([id,note])=>!/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id))||note.length>500)) throw new OrderError(400, 'Check the photo requests.');
  const intentHash = sha256(JSON.stringify({ cart: input.cart, customer: { name: input.customer.name.trim(), email: input.customer.email?.trim() || null, phone: input.customer.phone?.trim() || null, subjectName: input.customer.subjectName?.trim() || null, notes: input.customer.notes?.trim() || null, ...(Object.keys(photoRequests).length ? {photoRequests} : {}), ...(input.customer.emailUpdates ? {emailUpdates:true} : {}) } }));
  const existing = db.select().from(schema.orders).where(and(eq(schema.orders.eventId, event.id), eq(schema.orders.idempotencyKey, input.idempotencyKey))).get();
  if (existing) {
    if (existing.visitorSid !== input.sid || existing.intentHash !== intentHash) throw new OrderError(409, 'This order attempt already saved different details. Open the saved order before making changes.');
    return { order: existing, replay: true };
  }
  if (!event.orderingEnabled) throw new OrderError(403, 'Ordering is closed for this event');
  if (!input.cart.length) throw new OrderError(400, 'Cart is empty');
  const name = input.customer.name?.trim();
  if (!name) throw new OrderError(400, 'Name is required');
  const email = input.customer.email?.trim() || null, phone = input.customer.phone?.trim() || null;
  if (!email && !phone) throw new OrderError(400, 'We need one way to reach you: a phone number or an email');
  if (input.customer.emailUpdates && !email) throw new OrderError(400, 'Enter an email address for order updates.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OrderError(400, 'That email address does not look right');

  const { catalog } = eventCatalog(event.id, event.catalogId);
  const priced = quoteCart(event.id, input.sid, input.cart, catalog);
  if (!priced.complete) throw new OrderError(400, 'Please review your print selections', priced);
  if (!acceptedQuote(input.quoteToken, priced.quoteToken)) throw new OrderError(409, 'Your print options or total changed. Review the updated order and confirm it again.', priced);

  // Every photo must belong to this event.
  const photoIds = [...new Set(input.cart.flatMap((i) => i.sheets.flatMap((s) => s.cells.map((c) => c.photoId!).filter((x) => x != null))))];
  if (Object.keys(photoRequests).some(id => !photoIds.includes(Number(id)))) throw new OrderError(400, 'Photo requests must belong to the selected prints.');
  const photoRows = photoIds.length ? db.select({ id: schema.photos.id, stem: schema.photos.stem, galleryId: schema.photos.galleryId, galleryName: schema.galleries.name, eventId: schema.galleries.eventId })
    .from(schema.photos).innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId)).where(inArray(schema.photos.id, photoIds)).all() : [];
  const photoMap = new Map(photoRows.map((p) => [p.id, p]));
  for (const id of photoIds) { const p = photoMap.get(id); if (!p || p.eventId !== event.id || !visiblePhoto(id, event.id)) throw new OrderError(400, 'A selected photo is not part of this event'); }
  const printShas = new Map(photoIds.length ? db.select({ photoId: schema.photoFiles.photoId, sha: schema.photoFiles.sha256 }).from(schema.photoFiles)
    .where(and(inArray(schema.photoFiles.photoId, photoIds), eq(schema.photoFiles.role, 'print'))).all().map((r) => [r.photoId, r.sha]) : []);

  const settings = getSettings();
  const galleryIds = new Set(photoRows.map((p) => p.galleryId));
  const subjectName = input.customer.subjectName?.trim() || null;

  const order = sqlite.transaction(() => {
    let created: typeof schema.orders.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = db.insert(schema.orders).values({
          orderNumber: orderNumber(settings.orderTz), accessToken: randomToken(32), idempotencyKey: input.idempotencyKey, intentHash, eventId: event.id,
          galleryId: galleryIds.size === 1 ? [...galleryIds][0] : null, customerName: name, email, phone, subjectName, notes: input.customer.notes?.trim() || null,
          photoRequests, emailUpdates: input.customer.emailUpdates ? 1 : 0, status: 'new', subtotalCents: priced.subtotalCents, totalCents: priced.totalCents, currency: priced.currency, submittedIp: input.ip, visitorSid: input.sid,
          createdAt: nowIso(), updatedAt: nowIso()
        }).returning().get();
      } catch (err) { if (!/UNIQUE.*order_number/i.test(String(err))) throw err; }
    }
    if (!created) throw new OrderError(500, 'could not allocate an order number');
    priced.items.forEach((pi, idx) => {
      const cartItem = input.cart.find((c) => c.key === pi.key)!;
      const product = catalog.products.find((p) => p.id === pi.productId)!;
      const item = db.insert(schema.orderItems).values({ orderId: created!.id, productId: product.id, productCode: product.code, productName: product.name, productKind: product.kind, quantity: pi.quantity, unitPriceCents: pi.unitPriceCents, totalCents: pi.totalCents, sortOrder: idx }).returning().get();
      cartItem.sheets.forEach((sheet, sIdx) => {
        const tpl = catalog.sheets[sheet.templateCode];
        const sheetRow = db.insert(schema.orderItemSheets).values({ orderItemId: item.id, sheetIndex: sIdx, templateCode: tpl.code, label: tpl.label, paperWidthIn: tpl.paperWidthIn, paperHeightIn: tpl.paperHeightIn }).returning().get();
        for (const cell of sheet.cells) {
          const tplCell = tpl.cells.find((c) => c.cellIndex === cell.cellIndex)!;
          const geo = resolveCellGeometry(tplCell, tpl, cell.sizeChoice, catalog.printSizes);
          const photo = photoMap.get(cell.photoId!)!;
          db.insert(schema.orderItemCells).values({
            orderItemSheetId: sheetRow.id, cellIndex: cell.cellIndex, printSizeCode: cell.sizeChoice ?? tplCell.printSizeCode, label: tplCell.label,
            wIn: geo.wIn, hIn: geo.hIn, xIn: geo.xIn, yIn: geo.yIn, rotation: tplCell.rotation, rotated: cell.rotated ? 1 : 0, sizeChoice: cell.sizeChoice ?? null,
            photoId: photo.id, photoStem: photo.stem, galleryId: photo.galleryId, galleryName: photo.galleryName, printSha256: printShas.get(photo.id) ?? null, crop: null
          }).run();
        }
      });
    });
    db.insert(schema.orderEvents).values({ orderId: created.id, type: 'created', actor: 'parent', data: { ip: input.ip }, createdAt: nowIso() }).run();
    emitDomainEvent('order.created', notificationFor(created.id));
    return created;
  })();
  scheduleDeliveries();
  return { order, replay: false };
}

// ---- reading ---------------------------------------------------------------

export interface OrderDetail {
  order: typeof schema.orders.$inferSelect;
  event: { id: number; name: string; slug: string; subjectLabel: string };
  items: { id: number; productCode: string; productName: string; productKind: string; quantity: number; unitPriceCents: number; totalCents: number;
    sheets: { id: number; sheetIndex: number; templateCode: string; label: string; paperWidthIn: number; paperHeightIn: number;
      cells: { id: number; cellIndex: number; printSizeCode: string; label: string; wIn: number; hIn: number; xIn: number; yIn: number; rotation: number; rotated: number; sizeChoice: string | null; photoId: number | null; photoStem: string; galleryName: string; printSha256: string | null; thumbHash: string | null; currentPrintSha: string | null; photoWidth: number | null; photoHeight: number | null }[] }[] }[];
  payments: typeof schema.payments.$inferSelect[];
  paidCents: number;
  events: typeof schema.orderEvents.$inferSelect[];
  deliveries: { id: number; eventType: string; recipient: string | null; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string }[];
}

export function getOrderDetail(orderId: number): OrderDetail | null {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) return null;
  const event = db.select({ id: schema.events.id, name: schema.events.name, slug: schema.events.slug, subjectLabel: schema.events.subjectLabel }).from(schema.events).where(eq(schema.events.id, order.eventId)).get()!;
  const items = db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).orderBy(schema.orderItems.sortOrder).all();
  const sheets = items.length ? db.select().from(schema.orderItemSheets).where(inArray(schema.orderItemSheets.orderItemId, items.map((i) => i.id))).orderBy(schema.orderItemSheets.sheetIndex).all() : [];
  const cells = sheets.length ? db.select().from(schema.orderItemCells).where(inArray(schema.orderItemCells.orderItemSheetId, sheets.map((s) => s.id))).orderBy(schema.orderItemCells.cellIndex).all() : [];
  const photoIds = [...new Set(cells.map((c) => c.photoId).filter((x): x is number => x != null))];
  const photoRows = photoIds.length ? db.select({ id: schema.photos.id, h: schema.photos.renditionHash, w: schema.photos.width, hh: schema.photos.height }).from(schema.photos).where(inArray(schema.photos.id, photoIds)).all() : [];
  const hashes = new Map(photoRows.map((p) => [p.id, p.h]));
  const dims = new Map(photoRows.map((p) => [p.id, { w: p.w, h: p.hh }]));
  const currentPrint = new Map(photoIds.length ? db.select({ photoId: schema.photoFiles.photoId, sha: schema.photoFiles.sha256 }).from(schema.photoFiles).where(and(inArray(schema.photoFiles.photoId, photoIds), eq(schema.photoFiles.role, 'print'))).all().map((r) => [r.photoId, r.sha]) : []);
  const payments = db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId)).orderBy(schema.payments.paidAt).all();
  const events = db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, orderId)).orderBy(desc(schema.orderEvents.id)).all();
  const deliveries = db.select({ id: schema.notificationDeliveries.id, eventType: schema.notificationDeliveries.eventType, recipient: schema.notificationDeliveries.recipient, status: schema.notificationDeliveries.status, attempts: schema.notificationDeliveries.attempts, lastError: schema.notificationDeliveries.lastError, sentAt: schema.notificationDeliveries.sentAt, createdAt: schema.notificationDeliveries.createdAt })
    .from(schema.notificationDeliveries).where(sql`json_extract(${schema.notificationDeliveries.payload}, '$.data.orderId') = ${orderId}`).orderBy(desc(schema.notificationDeliveries.id)).all();
  return {
    order, event,
    items: items.map((i) => ({
      id: i.id, productCode: i.productCode, productName: i.productName, productKind: i.productKind, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents,
      sheets: sheets.filter((s) => s.orderItemId === i.id).map((s) => ({
        id: s.id, sheetIndex: s.sheetIndex, templateCode: s.templateCode, label: s.label, paperWidthIn: s.paperWidthIn, paperHeightIn: s.paperHeightIn,
        cells: cells.filter((c) => c.orderItemSheetId === s.id).map((c) => ({
          id: c.id, cellIndex: c.cellIndex, printSizeCode: c.printSizeCode, label: c.label, wIn: c.wIn, hIn: c.hIn, xIn: c.xIn, yIn: c.yIn, rotation: c.rotation, rotated: c.rotated, sizeChoice: c.sizeChoice,
          photoId: c.photoId, photoStem: c.photoStem, galleryName: c.galleryName, printSha256: c.printSha256, thumbHash: c.photoId ? hashes.get(c.photoId) ?? null : null, currentPrintSha: c.photoId ? currentPrint.get(c.photoId) ?? null : null, photoWidth: c.photoId ? dims.get(c.photoId)?.w ?? null : null, photoHeight: c.photoId ? dims.get(c.photoId)?.h ?? null : null
        }))
      }))
    })),
    payments, paidCents: payments.reduce((n, p) => n + p.amountCents, 0), events, deliveries
  };
}

export function getOrderByToken(token: string) { return db.select().from(schema.orders).where(eq(schema.orders.accessToken, token)).get(); }

export interface OrderFilter { status?: string; eventId?: number; unpaid?: boolean; q?: string; page?: number; orderIds?: number[]; }
function orderConditions(filter: OrderFilter) {
  const conds = [];
  if (filter.orderIds) conds.push(filter.orderIds.length ? inArray(schema.orders.id, filter.orderIds) : sql`0`);
  if (filter.status) conds.push(eq(schema.orders.status, filter.status));
  if (filter.eventId) conds.push(eq(schema.orders.eventId, filter.eventId));
  if (filter.q) { const q = `%${filter.q.toLowerCase()}%`; conds.push(sql`(lower(${schema.orders.customerName}) like ${q} or lower(${schema.orders.orderNumber}) like ${q} or lower(coalesce(${schema.orders.subjectName}, '')) like ${q} or lower(coalesce(${schema.orders.email}, '')) like ${q} or coalesce(${schema.orders.phone}, '') like ${q})`); }
  if (filter.unpaid) conds.push(sql`${schema.orders.status} != 'cancelled' AND (select coalesce(sum(amount_cents), 0) from payments p where p.order_id = orders.id) < ${schema.orders.totalCents}`);
  return conds.length ? and(...conds) : undefined;
}

export function matchingOrderIds(filter: OrderFilter = {}) { return db.select({id:schema.orders.id}).from(schema.orders).where(orderConditions(filter)).all().map(o=>o.id); }

export function listOrders(filter: OrderFilter = {}) {
  const rows = db.select({
    id: schema.orders.id, orderNumber: schema.orders.orderNumber, customerName: schema.orders.customerName, subjectName: schema.orders.subjectName, status: schema.orders.status,
    totalCents: schema.orders.totalCents, currency: schema.orders.currency, createdAt: schema.orders.createdAt, eventName: schema.events.name, eventId: schema.orders.eventId, email: schema.orders.email, phone: schema.orders.phone,
    paidCents: sql<number>`(select coalesce(sum(amount_cents), 0) from payments p where p.order_id = orders.id)`,
    itemSummary: sql<string>`(select group_concat(quantity || 'x ' || product_name, ', ') from order_items i where i.order_id = orders.id)`
  }).from(schema.orders).innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId)).where(orderConditions(filter)).orderBy(desc(schema.orders.id)).limit(50).offset((Math.max(1, filter.page ?? 1) - 1) * 50).all();
  return rows;
}

export function orderSummary(filter: OrderFilter = {}) {
  const rows = db.select({ id: schema.orders.id, status: schema.orders.status, total: schema.orders.totalCents,
    paid: sql<number>`(select coalesce(sum(amount_cents), 0) from payments p where p.order_id = orders.id)`
  }).from(schema.orders).where(orderConditions(filter)).all();
  const ids = rows.map((r) => r.id);
  const methods = ids.length ? db.select({ method: schema.payments.method, cents: sql<number>`sum(${schema.payments.amountCents})` }).from(schema.payments).where(inArray(schema.payments.orderId, ids)).groupBy(schema.payments.method).all() : [];
  return { count: rows.length, totalCents: rows.filter((r) => r.status !== 'cancelled').reduce((n, r) => n + r.total, 0), paidCents: rows.reduce((n, r) => n + r.paid, 0), dueCents: rows.filter((r) => r.status !== 'cancelled').reduce((n, r) => n + Math.max(0, r.total - r.paid), 0), methods };
}

export function countNewOrders(): number { return db.select({ n: sql<number>`count(*)` }).from(schema.orders).where(eq(schema.orders.status, 'new')).get()?.n ?? 0; }

// ---- mutations ---------------------------------------------------------------

export function transitionOrder(orderId: number, to: OrderStatus, actor: string): void {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new OrderError(404, 'order not found');
  if (!canTransition(order.status as OrderStatus, to)) throw new OrderError(400, `cannot go from ${order.status} to ${to}`);
  sqlite.transaction(() => {
    db.update(schema.orders).set({ status: to, updatedAt: nowIso() }).where(eq(schema.orders.id, orderId)).run();
    db.insert(schema.orderEvents).values({ orderId, type: 'status', actor, data: { from: order.status, to }, createdAt: nowIso() }).run();
    if (to === 'printed' || to === 'delivered') emitDomainEvent('order.status_changed', notificationFor(orderId));
  })();
  scheduleDeliveries();
}

export function recordPayment(orderId: number, input: { method: PaymentMethod; amountCents: number; reference?: string | null; actor: string; idempotencyKey: string }): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new OrderError(400, 'Amount must be positive whole cents');
  if (!PAYMENT_METHODS.includes(input.method) || !/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) throw new OrderError(400, 'Please reload the payment form');
  sqlite.transaction(() => {
    const existing = db.select().from(schema.payments).where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.idempotencyKey, input.idempotencyKey))).get();
    if (existing) {
      if (existing.method !== input.method || existing.amountCents !== input.amountCents || existing.reference !== (input.reference || null)) throw new OrderError(409, 'This payment attempt already recorded different details');
      return;
    }
    const removed = db.select({ id: schema.orderEvents.id }).from(schema.orderEvents).where(and(eq(schema.orderEvents.orderId, orderId), eq(schema.orderEvents.type, 'payment_removed'), sql`json_extract(${schema.orderEvents.data}, '$.idempotencyKey') = ${input.idempotencyKey}`)).get();
    if (removed) throw new OrderError(409, 'This payment entry was removed. Reload the form to record a new payment.');
    const before = getOrderDetail(orderId);
    if (!before) throw new OrderError(404, 'Order not found');
    if (before.order.status === 'cancelled') throw new OrderError(400, 'This order is cancelled');
    db.insert(schema.payments).values({ orderId, idempotencyKey: input.idempotencyKey, provider: 'manual', method: input.method, amountCents: input.amountCents, reference: input.reference || null, paidAt: nowIso(), createdAt: nowIso() }).run();
    db.insert(schema.orderEvents).values({ orderId, type: 'payment', actor: input.actor, data: { method: input.method, amountCents: input.amountCents, reference: input.reference ?? null }, createdAt: nowIso() }).run();
    db.update(schema.orders).set({ updatedAt: nowIso() }).where(eq(schema.orders.id, orderId)).run();
    const d = getOrderDetail(orderId)!;
    if (before.paidCents < d.order.totalCents && d.paidCents >= d.order.totalCents) emitDomainEvent('order.paid', notificationFor(orderId));
  })();
  scheduleDeliveries();
}

export function deletePayment(paymentId: number, actor: string, orderId: number): void {
  const p = db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).get();
  if (!p || p.orderId !== orderId) throw new OrderError(404, 'Payment not found');
  sqlite.transaction(() => {
  db.delete(schema.payments).where(eq(schema.payments.id, paymentId)).run();
  db.insert(schema.orderEvents).values({ orderId: p.orderId, type: 'payment_removed', actor, data: { paymentId: p.id, idempotencyKey: p.idempotencyKey, amountCents: p.amountCents, method: p.method, reference: p.reference }, createdAt: nowIso() }).run();
  })();
}

export function setAdminNotes(orderId: number, notes: string, actor: string): void {
  db.update(schema.orders).set({ adminNotes: notes, updatedAt: nowIso() }).where(eq(schema.orders.id, orderId)).run();
  db.insert(schema.orderEvents).values({ orderId, type: 'note', actor, data: null, createdAt: nowIso() }).run();
}

export function updateContact(orderId: number, patch: { customerName?: string; email?: string | null; phone?: string | null; subjectName?: string | null }, actor: string): void {
  db.update(schema.orders).set({ ...patch, updatedAt: nowIso() }).where(eq(schema.orders.id, orderId)).run();
  db.insert(schema.orderEvents).values({ orderId, type: 'contact_edited', actor, data: patch as Record<string, unknown>, createdAt: nowIso() }).run();
}

/** Text the photographer keys into a Lightroom Custom Package: one line per sheet cell. */
export function pickList(d: OrderDetail): string[] {
  const lines: string[] = [];
  for (const item of d.items) {
    lines.push(`${item.quantity}x ${item.productName}`);
    for (const sheet of item.sheets) {
      lines.push(`  Sheet ${sheet.sheetIndex + 1} (${sheet.label}):`);
      for (const c of sheet.cells) lines.push(`    ${c.sizeChoice ?? c.printSizeCode}${c.rotated ? ' (rotated)' : ''}: ${c.photoStem}${c.galleryName ? ` [${c.galleryName}]` : ''}${c.printSha256 ? '' : ' !! no print master'}`);
    }
  }
  return lines;
}

export function notificationFor(orderId: number): OrderNotification {
  const d = getOrderDetail(orderId)!;
  const s = getSettings();
  const note = `${d.order.orderNumber}${d.order.subjectName ? ` ${d.order.subjectName}` : ''}`;
  return {
    orderId, orderNumber: d.order.orderNumber, eventName: d.event.name, subjectName: d.order.subjectName, customerName: d.order.customerName, email: d.order.email, phone: d.order.phone,
    totalCents: d.order.totalCents, currency: d.order.currency, status: d.order.status,
    lines: d.items.map((i) => `${i.quantity}x ${i.productName} (${i.sheets.flatMap((s) => s.cells).map((c) => `${c.sizeChoice ?? c.printSizeCode}: ${c.photoStem}`).join(', ')})`),
    parentLines: d.items.map((i) => `${i.quantity}× ${i.productName} (${i.sheets.flatMap((s) => s.cells).map((c) => `${c.sizeChoice ?? c.printSizeCode}: Photo ${c.photoId ?? 'unavailable'}`).join(', ')})`),
    adminUrl: `${env.publicOrigin}/admin/orders/${orderId}`, statusUrl: `${env.publicOrigin}/o/${d.order.accessToken}`,
    venmoUrl: s.venmoHandle ? buildVenmoLink({ handle: s.venmoHandle, amountCents: Math.max(0, d.order.totalCents - d.paidCents), note, template: s.venmoTemplateHttps }) : null,
    paymentInstructions: s.paymentInstructionsMd, notes: d.order.notes, photoRequests: d.order.photoRequests, emailUpdates: d.order.emailUpdates == null ? undefined : Boolean(d.order.emailUpdates), pickupInstructions: db.select({pickup: schema.events.pickupInstructions}).from(schema.events).where(eq(schema.events.id,d.order.eventId)).get()?.pickup
  };
}
