import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { fulfillment } from '$server/fulfillment';
import { getOrderDetail } from '$server/orders';
import { printReadiness, createPrintInspection } from '$server/production';
export const load: PageServerLoad = async (e) => {
  const ids = [...new Set((e.url.searchParams.get('ids') ?? '').split(',').map(Number))];
  if (!ids.length || ids.length > 50 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw error(400, 'Choose up to 50 orders for job tickets');
  const orders = ids.map((id) => getOrderDetail(id));
  if (orders.some((o) => !o)) throw error(404, 'An order is no longer available');
  const inspect = createPrintInspection();
  const tickets = await Promise.all(orders.map(async (o) => ({ d: o!, work: fulfillment(o!), production: await printReadiness(o!, inspect) })));
  return { tickets };
};
