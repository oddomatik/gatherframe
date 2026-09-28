import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireEventAccess } from '$server/guard';
import { eventCatalog } from '$server/catalog';
import { quoteCart } from '$server/quote';
import { CartSchema } from '$server/schemas';

export const POST: RequestHandler = async (e) => {
  const { event, sid } = requireEventAccess(e);
  const body = await e.request.json().catch(() => null);
  const parsed = z.object({ cart: CartSchema }).safeParse(body);
  if (!parsed.success) throw error(400, 'Bad request');
  const { catalog } = eventCatalog(event.id, event.catalogId);
  return json(quoteCart(event.id, sid, parsed.data.cart, catalog));
};
