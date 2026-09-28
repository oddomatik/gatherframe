import { json, type RequestHandler } from '@sveltejs/kit';
import { createCollection, ensureIntake, GroupingError } from '$server/grouping';
import { listGalleries } from '$server/events';
export const POST: RequestHandler = async (e) => {
  try {
    const body = await e.request.json();
    const id = body.intake ? ensureIntake(Number(e.params.id)) : createCollection(Number(e.params.id), String(body.label ?? ''));
    return json({ gallery: listGalleries(Number(e.params.id)).find((g) => g.id === id) });
  } catch (err) { return json({ error: err instanceof GroupingError ? err.message : 'Could not create collection.' }, { status: 400 }); }
};
