import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { getEvent } from '$server/events';
export const GET: RequestHandler = (e) => {
  const event = getEvent(Number(e.params.id));
  if (!event) throw error(404, 'Event not found');
  e.cookies.set('pk_parent_preview', '1', { path: '/', httpOnly: true, sameSite: 'lax', secure: e.url.protocol === 'https:', maxAge: 3600 });
  throw redirect(303, `/g/${event.slug}`);
};
