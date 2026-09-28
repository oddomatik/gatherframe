import { error, type RequestHandler } from '@sveltejs/kit';
import { getEvent } from '$server/events';
import { linkPreviewResponse } from '$server/link-preview';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.admin) throw error(401, 'Please sign in');
  const event = getEvent(Number(params.id));
  if (!event) throw error(404, 'Not found');
  return linkPreviewResponse(event, request);
};
export const HEAD = GET;
