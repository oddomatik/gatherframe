import { error, type RequestHandler } from '@sveltejs/kit';
import { getEventBySlug } from '$server/events';
import { linkPreview, linkPreviewResponse } from '$server/link-preview';
import { nowIso } from '$server/env';

export const GET: RequestHandler = async ({ params, request }) => {
  const event = getEventBySlug(params.slug ?? "");
  // Only the explicitly chosen promotional image is public, not an album access grant.
  // Do not honor an admin cookie on this crawler endpoint.
  if (!event || !event.isPublished || (event.expiresAt && event.expiresAt <= nowIso())) throw error(404, 'Not found');
  if (params.image !== `${linkPreview(event).revision}.jpg`) throw error(404, 'Preview changed');
  return linkPreviewResponse(event, request);
};
export const HEAD = GET;
