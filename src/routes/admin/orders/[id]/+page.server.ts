import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deletePayment, getOrderDetail, OrderError, pickList, recordPayment, setAdminNotes, updateContact } from '$server/orders';
import { dollarsToCents } from '$shared/money';
import type { PaymentMethod } from '$shared/orders';
import { printReadiness } from '$server/production';
import { fulfillment, updateFulfillment } from '$server/fulfillment';
import { ORDER_STATUSES } from '$shared/orders';
import { PHOTO_WORK_STATES } from '$shared/fulfillment';
import { approvePrintMasters } from '$server/production-approval';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { env } from '$server/env';

export const load: PageServerLoad = async (e) => {
  const d = getOrderDetail(Number(e.params.id));
  if (!d) throw error(404, 'Order not found');
  return { work: fulfillment(d), workflowKey: randomUUID(), paymentKey: randomUUID(), production: await printReadiness(d), d, pick: pickList(d), statusUrl: `${env.publicOrigin}/o/${d.order.accessToken}` };
};

const actor = (e: { locals: App.Locals }) => e.locals.admin?.email ?? 'admin';

export const actions: Actions = {
  approveMasters: async (e) => {
    const f = await e.request.formData();
    try {
      const reviewed = z.array(z.object({ cellId: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(500).parse(JSON.parse(String(f.get('reviewed') ?? '[]')));
      const n = await approvePrintMasters(Number(e.params.id), reviewed, actor(e), String(f.get('reason') ?? '').slice(0, 1000));
      return { ok: `${n} print selections approved for production` };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Please reload and review the masters' }); }
  },
  work: async (e) => {
    const f = await e.request.formData();
    try {
      const parsed = z.discriminatedUnion('kind', [
        z.object({kind:z.literal('photo'),photoKey:z.string().regex(/^(photo|cell):[1-9][0-9]*$/),state:z.enum(PHOTO_WORK_STATES),note:z.string().max(2000)}),
        z.object({kind:z.literal('requests'),notes:z.string().max(4000)}),
        z.object({kind:z.literal('resolve_requests')})
      ]).parse(Object.fromEntries(f));
      const result=await updateFulfillment(Number(e.params.id),parsed,String(f.get('revision')??''),String(f.get('actionId')??''),actor(e));
      return {ok:result.message};
    } catch(err) {return fail(err instanceof OrderError?err.status:400,{error:err instanceof OrderError?err.message:'Check your preparation notes and try again.'});}
  },
  status: async (e) => {
    const f=await e.request.formData();
    try {
      const to=z.enum(ORDER_STATUSES).parse(f.get('to'));
      const result=await updateFulfillment(Number(e.params.id),{kind:'status',to},String(f.get('revision')??''),String(f.get('actionId')??''),actor(e));
      return {ok:result.message};
    } catch(err) {return fail(err instanceof OrderError?err.status:400,{error:err instanceof OrderError?err.message:'Check the status and try again.'});}
  },
  pay: async (e) => {
    const f = await e.request.formData();
    try { recordPayment(Number(e.params.id), { method: String(f.get('method')) as PaymentMethod, amountCents: dollarsToCents(String(f.get('amount') ?? '0')), idempotencyKey: String(f.get('idempotencyKey') ?? ''), reference: String(f.get('reference') ?? '') || null, actor: actor(e) }); }
    catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'failed' }); }
    return { ok: 'Payment recorded' };
  },
  unpay: async (e) => { const f = await e.request.formData(); deletePayment(Number(f.get('paymentId')), actor(e), Number(e.params.id)); return { ok: 'Payment removed' }; },
  notes: async (e) => { const f = await e.request.formData(); setAdminNotes(Number(e.params.id), String(f.get('adminNotes') ?? ''), actor(e)); return { ok: 'Notes saved' }; },
  contact: async (e) => {
    const f = await e.request.formData();
    updateContact(Number(e.params.id), { customerName: String(f.get('customerName') ?? '').trim() || undefined, email: String(f.get('email') ?? '').trim() || null, phone: String(f.get('phone') ?? '').trim() || null, subjectName: String(f.get('subjectName') ?? '').trim() || null }, actor(e));
    return { ok: 'Contact updated' };
  }
};
