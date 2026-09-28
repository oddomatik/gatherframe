import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getEvent } from '$server/events';
import {saveRecoverableOrganization,OrganizationConflict} from '$server/organization-recovery';
import { saveOrganization } from '$server/organizing';
import { GroupingError } from '$server/grouping';

export const POST: RequestHandler = async ({locals,params,request}) => {
  if (!locals.admin) throw error(401, 'Please sign in first');
  const eventId = Number(params.id);
  if (!getEvent(eventId)) throw error(404, 'Event not found');
  const body = await request.text();
  if (body.length > 2_000_000) throw error(413, 'Choose a smaller batch.');
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw error(400, 'Invalid sorting plan. Nothing was changed.'); }
  try { return json(input && typeof input==='object' && 'requestId' in input ? saveRecoverableOrganization(eventId,locals.admin.id,input) : saveOrganization(eventId, input)); }
  catch (err) { if(err instanceof OrganizationConflict)throw error(409,err.message);if (err instanceof GroupingError) throw error(400, err.message); throw err; }
};
