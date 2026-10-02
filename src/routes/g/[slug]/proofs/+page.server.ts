import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireEventAccess } from '$server/guard';
import { listProofRounds } from '$server/proofing';
export const load:PageServerLoad=e=>{const {event}=requireEventAccess(e);if(!event.guestGrant)throw error(404,'Not found');return {rounds:listProofRounds(event.id,event.guestGrant.id).map(r=>({id:r.id,title:r.title,status:r.status}))};};
