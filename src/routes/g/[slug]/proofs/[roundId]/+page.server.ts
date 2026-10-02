import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireEventAccess } from '$server/guard';
import { guestProofRound, saveProofSelection } from '$server/proofing';
import { visibleEventPhotos } from '$server/tag-browsing';
import { publicPhotos } from '$server/public';
import { rateLimit } from '$server/ratelimit';
export const load:PageServerLoad=e=>{const {event}=requireEventAccess(e);try{return {round:guestProofRound(event,Number(e.params.roundId)),photos:publicPhotos(visibleEventPhotos(event),event.variantPolicy,event)};}catch{throw error(404,'Selection round unavailable');}};
export const actions:Actions={default:async e=>{
  const {event,sid}=requireEventAccess(e);if(!rateLimit(`proof:${event.id}:${sid}`,60,60000).ok)throw error(429,'Please wait before saving again');
  const f=await e.request.formData(),ids=f.getAll('photoIds').map(Number),notes=Object.fromEntries(ids.map(id=>[String(id),String(f.get(`note_${id}`)??'')]));
  try{saveProofSelection(requireEventAccess(e).event,Number(e.params.roundId),{version:Number(f.get('version')),photoIds:ids,notes,message:String(f.get('message')??''),submit:f.get('intent')==='submit'});return {ok:f.get('intent')==='submit'?'Selection submitted to your photographer.':'Draft saved.'};}catch(err){return fail(409,{error:(err as Error).message});}
}};
