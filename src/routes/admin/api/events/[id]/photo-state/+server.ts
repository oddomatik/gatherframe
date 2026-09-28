import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getEvent } from '$server/events';
import { photoRevision } from '$server/photo-state';

export const GET: RequestHandler = (e) => {
  if (!e.locals.admin) throw error(401, 'Please sign in first');
  const id = Number(e.params.id);
  if (!getEvent(id)) throw error(404, 'Event not found');
  return json({ revision: photoRevision(id) }, { headers: { 'cache-control': 'private, no-store' } });
};
