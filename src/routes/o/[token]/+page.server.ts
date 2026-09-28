import { fulfillment } from '$server/fulfillment';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getOrderByToken, getOrderDetail } from '$server/orders';
import { db, schema } from '$server/db';
import { eq } from 'drizzle-orm';
import { mediaUrl } from '$server/media-access';
import { getSettings } from '$server/settings';
import { buildVenmoLink } from '$shared/venmo';

export const load: PageServerLoad = (e) => {
  const order = getOrderByToken(e.params.token);
  if (!order) throw error(404, 'Order not found');
  const d = getOrderDetail(order.id)!;
  const s = getSettings();
  const due = Math.max(0, d.order.totalCents - d.paidCents);
  const note = `${d.order.orderNumber}${d.order.subjectName ? ` ${d.order.subjectName}` : ''}`;
  const eventRecord = db.select().from(schema.events).where(eq(schema.events.id, order.eventId)).get()!;
  const photoUrls: Record<number, string> = {};
  for (const item of d.items) for (const sheet of item.sheets) for (const c of sheet.cells) if (c.photoId) photoUrls[c.photoId] = mediaUrl(eventRecord, c.photoId, 'thumb', c.thumbHash, order.id);
  const receipt = d.deliveries.find((delivery) => delivery.eventType === 'order.created' && delivery.recipient?.startsWith('parent_email:'));
  const receiptStatus = !order.email ? 'not_requested' : !receipt ? 'unavailable' : receipt.status === 'sent' ? 'sent' : receipt.status === 'dead' ? 'failed' : 'queued';
  return {
    photoUrls, receiptStatus, pickupInstructions: eventRecord.pickupInstructions, emailUpdatesAvailable: Boolean(s.smtp?.host),
    progress: ['printed','delivered','cancelled'].includes(order.status) ? order.status : order.status === 'in_progress' || fulfillment(d).photos.some(p=>p.state !== 'needs_review') ? 'preparing' : 'received',
    parentMessage: eventRecord.parentMessage,
    order: { number: d.order.orderNumber, status: d.order.status, createdAt: d.order.createdAt, customerName: d.order.customerName, subjectName: d.order.subjectName, email: d.order.email, phone: d.order.phone, notes: d.order.notes, photoRequests: d.order.photoRequests, emailUpdates: d.order.emailUpdates !== 0, totalCents: d.order.totalCents, paidCents: d.paidCents, currency: d.order.currency },
    event: d.event,
    items: d.items.map((i) => ({ id: i.id, productName: i.productName, quantity: i.quantity, totalCents: i.totalCents, sheets: i.sheets.map((s) => ({ id: s.id, sheetIndex: s.sheetIndex, cells: s.cells.map((c) => ({ id: c.id, cellIndex: c.cellIndex, printSizeCode: c.printSizeCode, sizeChoice: c.sizeChoice, photoId: c.photoId, thumbHash: c.thumbHash })) })) })),
    venmo: order.status !== 'cancelled' && s.venmoHandle && due > 0 ? { handle: s.venmoHandle, https: buildVenmoLink({ handle: s.venmoHandle, amountCents: due, note, template: s.venmoTemplateHttps }), app: buildVenmoLink({ handle: s.venmoHandle, amountCents: due, note, template: s.venmoTemplateApp }) } : null,
    paymentInstructions: s.paymentInstructionsMd,
    studio: { name: s.studioName, photographer: s.photographerName, contact: s.contactLine },
    justPlaced: e.url.searchParams.get('new') === '1'
  };
};

export const actions: Actions = {
  updates: async (e) => {
    const order = getOrderByToken(e.params.token);
    if (!order) throw error(404, 'Order not found');
    const enabled = (await e.request.formData()).get('updates') === 'on';
    if (enabled && (!getSettings().smtp?.host || !order.email)) return fail(400, {updatesError:'Email updates need a configured mail service and an email address on the order.'});
    db.update(schema.orders).set({emailUpdates:enabled?1:0}).where(eq(schema.orders.id,order.id)).run();
    return {updatesSaved:true};
  }
};
