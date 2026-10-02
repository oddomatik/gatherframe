import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getEvent, listGalleries } from '$server/events';
import { createGuestGrant, changeGuestGrant, listGuestGrants, setScopedSharingOnly } from '$server/sharing';
import { createProofRound, listProofRounds } from '$server/proofing';
function project(e:Pick<Parameters<PageServerLoad>[0], 'params'|'locals'>) { if(!e.locals.admin)throw error(401,'Please sign in');const event=getEvent(Number(e.params.id));if(!event)throw error(404,'Not found');return event; }
export const load:PageServerLoad=e=>{const event=project(e);return {event:{id:event.id,name:event.name,scopedSharingOnly:!!event.scopedSharingOnly},collections:listGalleries(event.id).filter(g=>!g.isIntake&&!g.isArchived).map(g=>({id:g.id,name:g.name})),grants:listGuestGrants(event.id),rounds:listProofRounds(event.id).map(r=>({id:r.id,grantId:r.grant_id,title:r.title,status:r.status}))};};
export const actions:Actions={
 create:async e=>{const event=project(e),f=await e.request.formData();try{const result=createGuestGrant(event.id,{label:String(f.get('label')??''),collectionIds:f.getAll('collections').map(Number),downloads:f.get('downloads')==='on',expiresAt:String(f.get('expiresAt')??'')});return {ok:'Invitation created. Copy its link now; it is only shown once.',shareUrl:e.url.origin+'/g/'+result.token};}catch(err){return fail(400,{error:(err as Error).message});}},
 change:async e=>{const event=project(e),f=await e.request.formData(),action=f.get('action');if(action!=='revoke'&&action!=='rotate')return fail(400,{error:'Choose a link action.'});try{const token=changeGuestGrant(event.id,Number(f.get('grantId')),action);return {ok:action==='revoke'?'Invitation revoked.':'Link rotated. Copy the new link now.',shareUrl:token?e.url.origin+'/g/'+token:undefined};}catch(err){return fail(400,{error:(err as Error).message});}},
 mode:async e=>{const event=project(e),f=await e.request.formData();try{setScopedSharingOnly(event.id,f.get('scopedOnly')==='on');return {ok:'Project access mode saved.'};}catch(err){return fail(400,{error:(err as Error).message});}},
 proof:async e=>{const event=project(e),f=await e.request.formData();try{createProofRound(event.id,Number(f.get('grantId')),String(f.get('title')??''));return {ok:'Selection round created. It is available through that invitation.'};}catch(err){return fail(400,{error:(err as Error).message});}}
};
