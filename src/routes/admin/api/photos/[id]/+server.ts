import { json, type RequestHandler } from '@sveltejs/kit';
import { deletePhoto } from '$server/ingest';
export const DELETE: RequestHandler = async (e) => {
  const r = await deletePhoto(Number(e.params.id));
  return r.ok ? json({ ok: true }) : json({ error: r.reason }, { status: 409 });
};
