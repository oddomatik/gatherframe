import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { env, nowIso } from './env';
import { enqueue } from './jobs';
import { sendMail } from './mail';
import { getSettings } from './settings';

export type DomainEventType = 'order.created' | 'order.paid' | 'order.status_changed' | 'test';
type Channel = 'email' | 'gotify' | 'webhook' | 'parent_email';

export interface OrderNotification {
  emailUpdates?: boolean; pickupInstructions?: string | null; photoRequests?: Record<string,string>;
  orderId: number; orderNumber: string; eventName: string; subjectName: string | null; customerName: string; email: string | null; phone: string | null;
  totalCents: number; currency: string; status: string; lines: string[]; parentLines?: string[]; adminUrl: string; statusUrl: string; venmoUrl: string | null; paymentInstructions: string; notes: string | null;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];

/**
 * Write one delivery row per subscribed channel. Call inside the order transaction; the job is enqueued
 * by the caller after commit. Never throws for channel misconfiguration.
 */
export function emitDomainEvent(type: DomainEventType, data: OrderNotification): void {
  const s = getSettings();
  const channels: { channel: Channel; recipient: string }[] = [];
  if (type === 'order.created' || type === 'test') {
    if (s.notifyEmail && s.smtp?.host && s.adminEmail) channels.push({ channel: 'email', recipient: s.adminEmail });
    if (s.notifyGotify && s.gotify?.url) channels.push({ channel: 'gotify', recipient: s.gotify.url });
    if (s.notifyWebhook && s.webhook?.url) channels.push({ channel: 'webhook', recipient: s.webhook.url });
  } else if (s.notifyWebhook && s.webhook?.url) channels.push({ channel: 'webhook', recipient: s.webhook.url });
  if (data.email && s.smtp?.host && (type === 'order.created' || type === 'order.paid' || (type === 'order.status_changed' && data.emailUpdates !== false))) channels.push({ channel: 'parent_email', recipient: data.email });
  const now = nowIso();
  for (const c of channels) {
    db.insert(schema.notificationDeliveries).values({ channelId: null, eventType: type, recipient: `${c.channel}:${c.recipient}`, payload: { channel: c.channel, type, data } as unknown as Record<string, unknown>, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now }).run();
  }
}

export function scheduleDeliveries(): void { enqueue('deliver_notification', {}, { dedupeKey: 'deliver', priority: 8 }); }

const DELIVERY_LEASE_MS = 5 * 60_000;

/**
 * Atomically claim before awaiting transport. nextAttemptAt doubles as a sending lease so
 * crashed claims can be retried without a migration. External transport is at-least-once:
 * a crash after SMTP accepted a message but before the acknowledgment can still retry it.
 */
export async function deliverPending(): Promise<void> {
  // Keep a finite job duration; the next job drains any remainder (including bursts > 50).
  for (let n = 0; n < 100; n++) {
    const now = nowIso();
    const lease = new Date(Date.now() + DELIVERY_LEASE_MS).toISOString();
    const claimed = sqlite.prepare(`UPDATE notification_deliveries
      SET status = 'sending', attempts = attempts + 1, next_attempt_at = ?
      WHERE id = (SELECT id FROM notification_deliveries
        WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'sending' AND next_attempt_at <= ?)
        ORDER BY id LIMIT 1)
      RETURNING id`).get(lease, now, now) as { id: number } | undefined;
    if (!claimed) break;
    const d = db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, claimed.id)).get()!;
    const payload = d.payload as unknown as { channel: Channel; type: DomainEventType; data: OrderNotification };
    // Lease + attempts fence acknowledgments from an expired worker after recovery.
    const owned = and(eq(schema.notificationDeliveries.id, d.id), eq(schema.notificationDeliveries.status, 'sending'), eq(schema.notificationDeliveries.nextAttemptAt, lease), eq(schema.notificationDeliveries.attempts, d.attempts));
    try {
      const code = await deliverOne(payload.channel, payload.type, payload.data, d.recipient, `picture-day-delivery-${d.id}`, d.createdAt);
      const skipped = code === 204 && payload.channel === 'parent_email';
      db.update(schema.notificationDeliveries).set({ status: skipped ? 'skipped' : 'sent', sentAt: skipped ? null : nowIso(), responseCode: code, lastError: null, nextAttemptAt: null }).where(owned).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[notify] ${payload.channel} delivery #${d.id} failed: ${msg}`);
      if (d.attempts >= BACKOFF_MS.length + 1) db.update(schema.notificationDeliveries).set({ status: 'dead', lastError: msg, nextAttemptAt: null }).where(owned).run();
      else db.update(schema.notificationDeliveries).set({ status: 'pending', lastError: msg, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[d.attempts - 1]).toISOString() }).where(owned).run();
    }
  }
  // Recover both delayed failures and >100-row bursts without waiting for another order.
  const next = sqlite.prepare(`SELECT min(coalesce(next_attempt_at, ?)) AS due FROM notification_deliveries WHERE status IN ('pending', 'sending')`).get(nowIso()) as { due: string | null };
  if (next.due) enqueue('deliver_notification', {}, { runAt: new Date(next.due), dedupeKey: 'deliver', priority: 8 });
}

async function deliverOne(channel: Channel, type: DomainEventType, data: OrderNotification, savedRecipient: string | null, deliveryId: string, createdAt: string): Promise<number> {
  const s = getSettings();
  const recipient = savedRecipient?.startsWith(`${channel}:`) ? savedRecipient.slice(channel.length + 1) : null;
  if (!recipient) throw new Error('Saved notification recipient missing');
  const title = type === 'test' ? `Test notification from ${s.studioName}` : type === 'order.created' ? `New order ${data.orderNumber} · ${money(data.totalCents, data.currency)}` : type === 'order.paid' ? `Order ${data.orderNumber} paid` : `Order ${data.orderNumber}: ${data.status}`;
  if (channel === 'email') {
    if (!s.smtp) throw new Error('SMTP not configured');
    await sendMail(s.smtp, { to: recipient, subject: title, text: adminText(data, type), messageId: `<${deliveryId}@picture-day.local>` });
    return 250;
  }
  if (channel === 'parent_email') {
    if (type === 'order.status_changed' && db.select({updates:schema.orders.emailUpdates}).from(schema.orders).where(eq(schema.orders.id,data.orderId)).get()?.updates === 0) return 204;
    if (!s.smtp || !data.email) throw new Error('SMTP or recipient missing');
    await sendMail(s.smtp, { to: recipient, messageId: `<${deliveryId}@picture-day.local>`, subject: type === 'order.created' ? `Your order ${data.orderNumber} from ${s.studioName}` : title, text: parentText(data, type, s.studioName, s.contactLine) });
    return 250;
  }
  if (channel === 'gotify') {
    if (!s.gotify) throw new Error('Gotify not configured');
    if (recipient !== s.gotify.url) throw new Error('Gotify destination changed; review this queued notification before retrying');
    const url = `${recipient.replace(/\/$/, '')}/message`;
    await assertAllowedUrl(url, s.gotify.url);
    const res = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-gotify-key': s.gotify.token },
      body: JSON.stringify({ title, message: adminText(data, type), priority: s.gotify.priority ?? 5, extras: { 'client::display': { contentType: 'text/markdown' }, 'client::notification': { click: { url: data.adminUrl } } } })
    });
    if (!res.ok) throw new Error(`gotify ${res.status}`);
    return res.status;
  }
  if (channel === 'webhook') {
    if (!s.webhook) throw new Error('webhook not configured');
    if (recipient !== s.webhook.url) throw new Error('Webhook destination changed; review this queued notification before retrying');
    await assertAllowedUrl(recipient, s.webhook.url);
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: deliveryId, type, created_at: createdAt, data });
    const sig = createHmac('sha256', s.webhook.secret ?? '').update(`${ts}.${body}`).digest('hex');
    const res = await fetch(recipient, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-webhook-event': type, 'x-webhook-timestamp': String(ts), 'x-webhook-signature': `sha256=${sig}` }, body
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    return res.status;
  }
  throw new Error(`unknown channel ${channel}`);
}

/** SSRF guard: http(s) only, no private/loopback targets unless GOTIFY_ALLOW_PRIVATE=1 and the host is the configured one. */
export async function assertAllowedUrl(url: string, configuredUrl: string): Promise<void> {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http(s) URLs are allowed');
  const host = u.hostname;
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  const priv = addrs.some(isPrivateIp);
  if (priv) {
    const configuredHost = new URL(configuredUrl).hostname;
    if (!(env.allowPrivateNotify && configuredHost === host)) throw new Error(`refusing to send to private address ${host} (set GOTIFY_ALLOW_PRIVATE=1 to allow the configured host)`);
  }
}

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivateIp(v.slice(7));
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

function money(cents: number, currency: string): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100); }

export function adminText(d: OrderNotification, type: DomainEventType): string {
  const contact = [d.phone, d.email].filter(Boolean).join(' · ') || 'no contact given';
  return [
    `**${d.orderNumber}** · ${d.eventName}${d.subjectName ? ` · ${d.subjectName}` : ''}`,
    `${d.customerName} · ${contact}`,
    '', ...d.lines.map((l) => `- ${l}`), '',
    `Total ${money(d.totalCents, d.currency)} · status ${d.status}${type === 'order.paid' ? ' · PAID' : ''}`,
    d.notes ? `Notes: ${d.notes}` : '',
    d.adminUrl
  ].filter((l) => l !== undefined).join('\n');
}

export function parentText(d: OrderNotification, type: DomainEventType, studio: string, contactLine: string): string {
  const head = type === 'order.created' ? `Thanks, ${d.customerName}! We received your order.` : type === 'order.paid' ? `We recorded your payment for order ${d.orderNumber}. Thank you!` : `Your order ${d.orderNumber} is now: ${d.status.replace('_', ' ')}.`;
  return [
    head, '', `Order ${d.orderNumber}`, ...(d.parentLines ?? ['View your print selections using the order link below.']).map((l) => `- ${l}`), `Total ${money(d.totalCents, d.currency)}`, '',
    ...Object.entries(d.photoRequests ?? {}).map(([id,note])=>`Request for Photo ${id}: ${note}`),
    ['printed','delivered'].includes(d.status) && d.pickupInstructions ? `Pickup / delivery: ${d.pickupInstructions}` : '',
    d.status === 'cancelled' || type === 'order.paid' ? '' : d.paymentInstructions, d.status !== 'cancelled' && type !== 'order.paid' && d.venmoUrl ? `Venmo: ${d.venmoUrl}` : '', '', `Order status: ${d.statusUrl}`, '', studio, contactLine
  ].filter((l) => l !== undefined).join('\n');
}
