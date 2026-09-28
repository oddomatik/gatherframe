import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sqlite} from './db';
import {nowIso} from './env';
import {saveOrganization} from './organizing';
import {GroupingError} from './grouping';
const idsSchema=z.array(z.number().int().positive()).min(1).max(5000);
type Snapshot={photos:{id:number;members:number[]}[];galleries:{id:number;name:string;is_archived:number;is_intake:number;cover_photo_id:number|null}[]};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class OrganizationConflict extends GroupingError {}
export function organizationState(eventId:number,rawIds:unknown) {
 const ids=idsSchema.safeParse(rawIds);if(!ids.success)throw new GroupingError('Choose a valid photo batch.');
 const galleries=sqlite.prepare('SELECT id,name,is_archived,is_intake,cover_photo_id FROM galleries WHERE event_id=? ORDER BY id').all(eventId) as Snapshot['galleries'];
 const photos=[...new Set(ids.data)].sort((a,b)=>a-b).map(id=>{
   if(!sqlite.prepare('SELECT 1 FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=? AND g.event_id=?').get(id,eventId))throw new OrganizationConflict('A photo from this draft is no longer available. Review your batch.');
   const members=(sqlite.prepare('SELECT gallery_id id FROM gallery_photos WHERE photo_id=? ORDER BY gallery_id').all(id) as {id:number}[]).map(r=>r.id);
   return {id,members};
 });
 const state={photos,galleries};return {revision:digest(state),state};
}
const saveSchema=z.object({requestId:z.uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/),photoIds:idsSchema,targets:z.array(z.unknown()).min(1).max(200)}).strict();
export function saveRecoverableOrganization(eventId:number,actor:number,input:unknown) {
 const parsed=saveSchema.safeParse(input);if(!parsed.success)throw new GroupingError('Invalid sorting draft. Nothing was changed.');
 const data=parsed.data,intent=JSON.stringify(data);
 return sqlite.transaction(()=>{
   const prior=sqlite.prepare('SELECT * FROM organization_actions WHERE id=?').get(data.requestId) as {user_id:number;event_id:number;intent:string;result:string;undone_at:string|null}|undefined;
   if(prior){if(prior.user_id!==actor||prior.event_id!==eventId||prior.intent!==intent)throw new OrganizationConflict('This save identifier was already used. Reload your draft.');if(prior.undone_at)throw new OrganizationConflict('This save was undone. Start a new sorting batch.');return JSON.parse(prior.result) as {photos:number;collections:number;actionId:string};}
   const before=organizationState(eventId,data.photoIds);
   if(before.revision!==data.revision)throw new OrganizationConflict('Collections changed since this draft began. Review the latest collections before saving.');
   for(const target of data.targets) {
     const t=target as {photoIds?:unknown};if(!Array.isArray(t?.photoIds)||t.photoIds.some(id=>!data.photoIds.includes(id)))throw new GroupingError('Assignments must belong to this sorting batch.');
   }
   const result={...saveOrganization(eventId,{targets:data.targets}),actionId:data.requestId};
   const after=organizationState(eventId,data.photoIds);
   sqlite.prepare('INSERT INTO organization_actions(id,user_id,event_id,intent,before_state,after_state,result,created_at) VALUES(?,?,?,?,?,?,?,?)').run(data.requestId,actor,eventId,intent,JSON.stringify(before.state),JSON.stringify(after.state),JSON.stringify(result),nowIso());
   return result;
 })();
}
export function undoOrganization(eventId:number,actor:number,id:string) {
 return sqlite.transaction(()=>{
   const row=sqlite.prepare('SELECT * FROM organization_actions WHERE id=? AND event_id=? AND user_id=?').get(id,eventId,actor) as {before_state:string;after_state:string;undone_at:string|null}|undefined;
   if(!row)throw new GroupingError('Sorting save not found.');if(row.undone_at)return {undone:true};
   const before=JSON.parse(row.before_state) as Snapshot,after=JSON.parse(row.after_state) as Snapshot;
   const current=organizationState(eventId,after.photos.map(p=>p.id)).state;
   // Conservative conflict check: never undo over a later assignment, archive or manual cover.
   if(digest(current)!==digest(after))throw new OrganizationConflict('Collections changed after this save. Undo was not applied; review the affected photos.');
   for(const p of before.photos){sqlite.prepare('DELETE FROM gallery_photos WHERE photo_id=?').run(p.id);for(const g of p.members)sqlite.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(g,p.id);}
   sqlite.prepare('UPDATE organization_actions SET undone_at=? WHERE id=?').run(nowIso(),id);
   // New collection shells remain available; no links, files, tags or orders are removed.
   return {undone:true};
 })();
}
export function latestOrganization(eventId:number,actor:number) {
 const row=sqlite.prepare('SELECT id,result,created_at FROM organization_actions WHERE event_id=? AND user_id=? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1').get(eventId,actor) as {id:string;result:string;created_at:string}|undefined;
 return row?{id:row.id,photos:JSON.parse(row.result).photos as number,createdAt:row.created_at}:null;
}
