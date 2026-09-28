import { json, type RequestHandler } from '@sveltejs/kit';
import { deletePhotoFile, IngestError } from '$server/ingest';
export const DELETE: RequestHandler = async (e) => {
  try { await deletePhotoFile(Number(e.params.id)); return json({ ok: true }); }
  catch (err) { if (err instanceof IngestError) return json({ error: err.message }, { status: err.status }); throw err; }
};
