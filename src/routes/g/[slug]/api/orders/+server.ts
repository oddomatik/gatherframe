import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { clientIp, requireEventAccess } from '$server/guard';
import { db, schema } from '$server/db';
import { and, eq } from 'drizzle-orm';
import { guestEventBySlug } from '$server/sharing';
import { visitorSid } from '$server/access';
import { createOrder, OrderError } from '$server/orders';
import { rateLimit } from '$server/ratelimit';
import { CartSchema } from '$server/schemas';

const Body = z.object({
  cart: CartSchema.min(1),
  quoteToken: z.string().max(200).optional(),
  idempotencyKey: z.string().min(8).max(80),
  customer: z.object({ name: z.string().max(120), phone: z.string().max(40).optional().nullable(), email: z.string().max(200).optional().nullable(), subjectName: z.string().max(120).optional().nullable(), notes: z.string().max(2000).optional().nullable(), photoRequests: z.record(z.string().regex(/^[1-9][0-9]*$/), z.string().max(500)).refine(v => Object.keys(v).length <= 200 && Object.values(v).join('').length <= 20000).optional(), emailUpdates: z.boolean().optional() }),
  website: z.string().max(0).optional() // honeypot
});

export const POST: RequestHandler = async (e) => {
  const body = await e.request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw error(400, 'Bad request');
  const event = guestEventBySlug(String(e.params.slug));
  if (!event) throw error(404, 'Not found');
  const sid = visitorSid(e.cookies, e.url.protocol === 'https:');
  const saved = db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.eventId, event.id), eq(schema.orders.idempotencyKey, parsed.data.idempotencyKey), eq(schema.orders.visitorSid, sid))).get();
  // A saved exact attempt remains recoverable after ordering closes or a limit is reached.
  const ctx = saved && !event.guestGrant && !event.scopedSharingOnly ? { event, sid } : requireEventAccess(e);
  if (parsed.data.website) return json({ ok: true, orderNumber: 'PO-00000000-SPAM', url: '/' }); // honeypot filled: pretend
  if (!saved && !rateLimit(`order:${ctx.sid}`, 10, 3_600_000).ok) throw error(429, 'Too many orders from this device. Please wait a bit.');
  if (!saved && !rateLimit(`order:event:${ctx.event.id}`, 300, 86_400_000).ok) throw error(429, 'Ordering is temporarily paused. Please try again later.');
  try {
    const { order, replay } = createOrder({ event: ctx.event, cart: parsed.data.cart, quoteToken: parsed.data.quoteToken, customer: parsed.data.customer, idempotencyKey: parsed.data.idempotencyKey, ip: clientIp(e), sid: ctx.sid });
    return json({ ok: true, replay, orderNumber: order.orderNumber, url: `/o/${order.accessToken}` });
  } catch (err) {
    if (err instanceof OrderError) return json({ error: err.message, details: err.details ?? null, ...(err.status === 409 && err.details && typeof err.details === 'object' && 'quoteToken' in err.details ? { quote: err.details } : {}) }, { status: err.status });
    throw err;
  }
};
