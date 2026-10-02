import { scopeAllowsPhoto } from '$server/sharing';
import { visiblePhoto } from '$server/media-access';
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
  if(!event.orderingEnabled)throw error(403,'Ordering is closed');
  if(parsed.data.cart.some(i=>i.sheets.some(s=>s.cells.some(c=>c.photoId!==null&&(!scopeAllowsPhoto(event,c.photoId)||!visiblePhoto(c.photoId,event.id))))))throw error(404,'Photo unavailable');
  const { catalog } = eventCatalog(event.id, event.catalogId);
  return json(quoteCart(event.id, sid, parsed.data.cart, catalog));
};
