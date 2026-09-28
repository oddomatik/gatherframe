import { error, json, type RequestHandler } from '@sveltejs/kit';
import { changePhotoTags, deleteTag, saveTag } from '$server/tags';
export const POST: RequestHandler = async (e) => {
  if (!e.locals.admin) throw error(401, 'Please sign in first');
  try {
    const b = await e.request.json(), eventId = Number(e.params.id);
    if (b.action === 'save') return json({ tag: saveTag(eventId, { id:b.id, name:b.name, parentId:b.parentId, shared:b.shared === true }) });
    if (b.action === 'delete') { deleteTag(eventId,b.id); return json({ok:true}); }
    if (b.action === 'add' || b.action === 'remove') return json({count:changePhotoTags(eventId,b.photoIds,b.tagIds,b.action)});
    throw new Error('Unknown tag action.');
  } catch (err) { return json({error:err instanceof Error ? err.message : 'Could not update tags.'},{status:400}); }
};
