import { sqlite } from './db';
import { nowIso } from './env';
import type { Event } from './db/schema';
import { grantActive, grantById, scopeAllowsPhoto } from './sharing';
export class ProofError extends Error {}
export interface ProofRound { id:number;event_id:number;grant_id:number;title:string;status:'open'|'submitted'|'accepted'|'closed';version:number;selection:string;notes:string;message:string;review_note:string;created_at:string;updated_at:string; }
export function getProofRound(id:number) { return sqlite.prepare('SELECT * FROM proof_rounds WHERE id=?').get(id) as ProofRound|undefined; }
export function listProofRounds(eventId:number,grantId?:number) {
  return sqlite.prepare(`SELECT * FROM proof_rounds WHERE event_id=? ${grantId===undefined?'':'AND grant_id=?'} ORDER BY id DESC`).all(...(grantId===undefined?[eventId]:[eventId,grantId])) as ProofRound[];
}
export function createProofRound(eventId:number,grantId:number,title:string) {
  const grant=grantById(grantId);title=title.trim();
  if(!grantActive(grant)||grant.event_id!==eventId||!title||title.length>120)throw new ProofError('Choose an active invitation and enter a title up to 120 characters.');
  return Number(sqlite.prepare('INSERT INTO proof_rounds(event_id,grant_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(eventId,grantId,title,nowIso(),nowIso()).lastInsertRowid);
}
export function guestProofRound(event:Event,id:number) {
  const round=getProofRound(id);
  if(!event.guestGrant||!round||round.event_id!==event.id||round.grant_id!==event.guestGrant.id)throw new ProofError('Selection round unavailable.');
  // Previously submitted photos that leave scope must not appear in a guest response.
  const selected=(JSON.parse(round.selection) as number[]).filter(id=>scopeAllowsPhoto(event,id));
  const notes=Object.fromEntries(Object.entries(JSON.parse(round.notes) as Record<string,string>).filter(([id])=>selected.includes(Number(id))));
  return {id:round.id,title:round.title,status:round.status,version:round.version,selected,notes,message:round.message,reviewNote:round.review_note};
}
export function saveProofSelection(event:Event,id:number,input:{version:number;photoIds:number[];notes:Record<string,string>;message:string;submit:boolean}) {
  return sqlite.transaction(()=>{
    const round=getProofRound(id),grant=event.guestGrant&&grantById(event.guestGrant.id);
    if(!round||!event.guestGrant||!grantActive(grant)||grant.version!==event.guestGrant.version||round.grant_id!==grant.id||round.event_id!==event.id)throw new ProofError('Selection round unavailable.');
    const ids=[...new Set(input.photoIds)].sort((a,b)=>a-b);
    if(!Number.isSafeInteger(input.version)||input.version<0||ids.length>2000||ids.some(id=>!Number.isSafeInteger(id)||id<1||!scopeAllowsPhoto(event,id)))throw new ProofError('One or more photos are no longer available. Reload before saving.');
    if(typeof input.message!=='string'||input.message.length>2000||!input.notes||Array.isArray(input.notes)||Object.keys(input.notes).length>2000)throw new ProofError('Check the selection notes.');
    if(Object.entries(input.notes).some(([id,note])=>!ids.includes(Number(id))||typeof note!=='string'||note.length>500))throw new ProofError('Notes must belong to selected photos and be at most 500 characters.');
    const notes=Object.fromEntries(Object.entries(input.notes).map(([id,note])=>[id,note.trim()]).filter(([,note])=>note));
    if(Object.values(notes).join('').length>20000)throw new ProofError('Selection notes are too long.');
    const selection=JSON.stringify(ids),serializedNotes=JSON.stringify(notes),message=input.message.trim();
    // An exact retry of a submitted revision returns its receipt, without creating another submission.
    if(input.submit&&round.status==='submitted'&&round.version===input.version+1&&round.selection===selection&&round.notes===serializedNotes&&round.message===message)return {version:round.version,replay:true};
    if(round.status!=='open'||round.version!==input.version)throw new ProofError('This round changed or is locked. Reload before continuing.');
    if(input.submit&&!ids.length)throw new ProofError('Select at least one photo before submitting.');
    const version=round.version+1,now=nowIso();
    sqlite.prepare('UPDATE proof_rounds SET status=?,version=?,selection=?,notes=?,message=?,updated_at=? WHERE id=?').run(input.submit?'submitted':'open',version,selection,serializedNotes,message,now,id);
    if(input.submit)sqlite.prepare('INSERT INTO proof_submissions(round_id,revision,selection,notes,message,submitted_at) VALUES(?,?,?,?,?,?)').run(id,version,selection,serializedNotes,message,now);
    return {version,replay:false};
  })();
}
export function reviewProofRound(eventId:number,id:number,version:number,status:'open'|'accepted'|'closed',note:string) {
  sqlite.transaction(()=>{
    const round=getProofRound(id);
    if(!round||round.event_id!==eventId||round.version!==version)throw new ProofError('This round changed. Reload before reviewing.');
    if(!['open','accepted','closed'].includes(status)||note.length>2000||(status==='accepted'&&round.status!=='submitted'))throw new ProofError('Only a submitted round can be accepted.');
    sqlite.prepare('UPDATE proof_rounds SET status=?,review_note=?,version=version+1,updated_at=? WHERE id=?').run(status,note.trim(),nowIso(),id);
  })();
}
export function proofHistory(roundId:number) { return sqlite.prepare('SELECT * FROM proof_submissions WHERE round_id=? ORDER BY revision DESC').all(roundId) as {id:number;revision:number;selection:string;notes:string;message:string;submitted_at:string}[]; }
