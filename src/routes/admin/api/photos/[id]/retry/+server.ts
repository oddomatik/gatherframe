import { json, type RequestHandler } from '@sveltejs/kit';
import { retryPhotoRendering } from '$server/images';
export const POST: RequestHandler = async (e) => {
  try { await retryPhotoRendering(Number(e.params.id)); return json({ ok: true }); }
  catch (err) { return json({ error: err instanceof Error ? err.message : 'Could not retry this photo.' }, { status: 400 }); }
};
