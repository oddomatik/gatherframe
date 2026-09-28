import type { PageServerLoad } from './$types';
import { listOrders, getOrderDetail, orderSummary, matchingOrderIds, type OrderFilter } from '$server/orders';
import { printReadiness, createPrintInspection } from '$server/production';
import { fulfillment } from '$server/fulfillment';
import { getSettings } from '$server/settings';
import { listEvents } from '$server/events';

export const load: PageServerLoad = async (e) => {
  const q = e.url.searchParams;
  const filter: OrderFilter & {work?:string} = {work: ['review','touchups','ready'].includes(q.get('work')??'') ? q.get('work')! : undefined, status: q.get('status') || undefined, eventId: Number(q.get('event')) || undefined, unpaid: q.get('unpaid') === '1', q: q.get('q') || undefined, page: Math.min(10000, Math.max(1, Math.floor(Number(q.get('page')) || 1))) };
  if (filter.work) filter.orderIds = matchingOrderIds(filter).filter(id=>fulfillment(getOrderDetail(id)!).stage===filter.work);
  const summary = orderSummary(filter);
  filter.page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(summary.count / 50)));
  const inspect = createPrintInspection();
  const orders = await Promise.all(listOrders(filter).map(async (o) => {
    const d = getOrderDetail(o.id)!;
    const work = fulfillment(d);
    const readiness = !['cancelled', 'delivered'].includes(o.status) ? await printReadiness(d, inspect) : null;
    return { ...o, work: {stage:work.stage, reviewed:work.reviewed, photos:work.photos.length, requestsPending:!work.requestsAddressed}, production: readiness ? readiness.ready ? 'Ready' : `${readiness.conflicts.length} on hold` : '—' };
  }));
  return { summary, currency: getSettings().currency, orders, events: listEvents().map((x) => ({ id: x.id, name: x.name })), filter: {status:filter.status,eventId:filter.eventId,unpaid:filter.unpaid,q:filter.q,page:filter.page!,work:filter.work} };
};
