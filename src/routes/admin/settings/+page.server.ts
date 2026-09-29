import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getSettings, updateSettings } from '$server/settings';
import { db, schema } from '$server/db';
import { deliverPending, emitDomainEvent } from '$server/notify';
import { env } from '$server/env';
import { jobStats, retryDeadJobs } from '$server/jobs';
import { inArray } from 'drizzle-orm';

export const load: PageServerLoad = () => {
  const s = getSettings();
  return {
    settings: { ...s, smtp: s.smtp ? { ...s.smtp, pass: s.smtp.pass ? '••••••••' : '' } : null, gotify: s.gotify ? { ...s.gotify, token: s.gotify.token ? '••••••••' : '' } : null, webhook: s.webhook ? { ...s.webhook, secret: s.webhook.secret ? '••••••••' : '' } : null },
    deliveries: db.select().from(schema.notificationDeliveries).orderBy(desc(schema.notificationDeliveries.id)).limit(30).all().map((d) => ({ id: d.id, eventType: d.eventType, recipient: d.recipient, status: d.status, attempts: d.attempts, lastError: d.lastError, sentAt: d.sentAt, createdAt: d.createdAt })),
    jobs: jobStats(), publicOrigin: env.publicOrigin, allowPrivate: env.allowPrivateNotify
  };
};

export const actions: Actions = {
  save: async (e) => {
    const f = await e.request.formData(); const s = getSettings();
    const str = (k: string) => String(f.get(k) ?? '').trim();
    const keep = (v: string, old: string) => (v === '••••••••' ? old : v);
    updateSettings({
      studioName: str('studioName') || 'Photo Studio', photographerName: str('photographerName'), contactLine: str('contactLine'), currency: str('currency') || 'USD', adminEmail: str('adminEmail'),
      venmoHandle: str('venmoHandle'), paymentInstructionsMd: str('paymentInstructionsMd') || s.paymentInstructionsMd, orderTz: str('orderTz') || s.orderTz,
      notifyEmail: f.get('notifyEmail') === 'on', notifyGotify: f.get('notifyGotify') === 'on', notifyWebhook: f.get('notifyWebhook') === 'on',
      smtp: str('smtpHost') ? { host: str('smtpHost'), port: Number(str('smtpPort')) || 587, secure: f.get('smtpSecure') === 'on', user: str('smtpUser'), pass: keep(str('smtpPass'), s.smtp?.pass ?? ''), from: str('smtpFrom') } : null,
      gotify: str('gotifyUrl') ? { url: str('gotifyUrl').replace(/\/$/, ''), token: keep(str('gotifyToken'), s.gotify?.token ?? ''), priority: Number(str('gotifyPriority')) || 5 } : null,
      webhook: str('webhookUrl') ? { url: str('webhookUrl'), secret: keep(str('webhookSecret'), s.webhook?.secret ?? '') } : null
    });
    return { ok: 'Settings saved' };
  },
  test: async () => {
    emitDomainEvent('test', { orderId: 0, orderNumber: 'PO-TEST-0000', eventName: 'Test event', subjectName: 'Sample reference', customerName: 'Sample customer', email: null, phone: '555-0100', totalCents: 2000, currency: getSettings().currency, status: 'new', lines: ['1x Standard package (8x10: img_0001, 5x7: img_0002, wallet: img_0001 ×4)'], adminUrl: `${env.publicOrigin}/admin/orders`, statusUrl: `${env.publicOrigin}/o/test`, venmoUrl: null, paymentInstructions: '', notes: null });
    await deliverPending();
    const last = db.select().from(schema.notificationDeliveries).orderBy(desc(schema.notificationDeliveries.id)).limit(5).all();
    const failed = last.filter((d) => d.eventType === 'test' && d.status !== 'sent');
    return failed.length ? fail(400, { error: `Test sent with errors: ${failed.map((d) => `${d.recipient?.split(':')[0]}: ${d.lastError}`).join('; ')}` }) : { ok: `Test notification sent to ${last.filter((d) => d.eventType === 'test').length} channel(s)` };
  },
  retry: async () => {
    db.update(schema.notificationDeliveries).set({ status: 'pending', nextAttemptAt: new Date().toISOString(), attempts: 0 }).where(inArray(schema.notificationDeliveries.status, ['dead', 'pending'])).run();
    const n = retryDeadJobs();
    await deliverPending();
    return { ok: `Retried dead deliveries and ${n} dead job(s)` };
  }
};
