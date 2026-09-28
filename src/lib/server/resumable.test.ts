import {beforeEach,afterAll,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
vi.mock('./env',async()=>{const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');return {env:{dataDir:mkdtempSync(tmpdir()+'/picday-tus-'),secret:'fixture',publicOrigin:'https://fixture.invalid',maxUploadBytes:32*1024**2},nowIso:()=>new Date().toISOString()};});
vi.mock('./db',async()=>{const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');const schema=await import('./db/schema');const {MIGRATIONS}=await import('./db/migrations');const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);return {sqlite,schema,db:drizzle(sqlite,{schema})};});
import {sqlite,db,schema} from './db';
import {env,nowIso} from './env';
import {ensureIntake} from './grouping';
import {prepareTransfer,receiveTransfer,finishTransfer,cleanExpiredTransfers} from './resumable';
import {shutdownImages} from './images';
let eventId:number,galleryId:number,actor:number,body:Buffer;
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const input=(bytes=body)=>({galleryId,filename:'IMG_0042.jpg',role:'print',bytes:bytes.length,sha256:sha(bytes),replacement:'reject'});
async function prepare(bytes=body,extra={}){return await prepareTransfer(eventId,actor,{...input(bytes),...extra}) as {id:string;url:string;offset:number;result?:{status:string}};}
async function patch(id:string,bytes:Buffer,offset=0,who=actor){return receiveTransfer(id,who,new Request(`https://fixture.invalid/admin/api/transfers/${id}`,{method:'PATCH',headers:{'tus-resumable':'1.0.0','content-type':'application/offset+octet-stream','upload-offset':String(offset),'content-length':String(bytes.length)},body:new Uint8Array(bytes)}));}
beforeEach(async()=>{sqlite.exec('DELETE FROM upload_sessions;DELETE FROM jobs;DELETE FROM photos;DELETE FROM galleries;DELETE FROM events;DELETE FROM admin_users;DELETE FROM storage_objects;');actor=Number(sqlite.prepare('INSERT INTO admin_users(email,password_hash,created_at) VALUES(?,?,?)').run('test@invalid','fixture',nowIso()).lastInsertRowid);eventId=db.insert(schema.events).values({slug:'test',name:'fixture',variantPolicy:{social:'free',print:'free',raw:'disabled'},createdAt:nowIso(),updatedAt:nowIso()}).returning().get().id;galleryId=ensureIntake(eventId);body=await sharp({create:{width:64,height:48,channels:3,background:'#c89867'}}).jpeg().toBuffer();});
afterAll(async()=>{await shutdownImages();sqlite.close();await fs.rm(env.dataDir,{recursive:true,force:true});});
it('resumes from persisted offset, validates bytes, and replays finalization without new rows',async()=>{
 const t=await prepare();expect((await patch(t.id,body.subarray(0,100))).status).toBe(204);
 const next=await prepare();expect(next.id).toBe(t.id);expect(next.offset).toBe(100);
 await expect(finishTransfer(t.id,eventId,actor)).rejects.toMatchObject({status:409});
 expect((await patch(t.id,body.subarray(100),100)).status).toBe(204);
 const result=await finishTransfer(t.id,eventId,actor);expect(result.sha256).toBe(sha(body));
 expect(await finishTransfer(t.id,eventId,actor)).toEqual(result);expect(sqlite.prepare('select count(*) n from photos').get()).toEqual({n:1});
 expect((await prepare()).result?.status).toBe('unchanged');
});
it('rejects another owner, wrong offset, expired transfers and incomplete hashes',async()=>{
 const t=await prepare();await expect(patch(t.id,body,0,actor+99)).rejects.toMatchObject({status:404});
 expect((await patch(t.id,body,5)).status).toBe(409);
 const bad=Buffer.from(body);bad[bad.length-1]^=1;await patch(t.id,bad);
 await expect(finishTransfer(t.id,eventId,actor)).rejects.toMatchObject({status:422});expect(sqlite.prepare('select count(*) n from photos').get()).toEqual({n:0});
 const expired=await prepare();sqlite.prepare("update upload_sessions set expires_at='2000-01-01'").run();await expect(patch(expired.id,body)).rejects.toMatchObject({status:410});await cleanExpiredTransfers();expect(sqlite.prepare('select count(*) n from upload_sessions').get()).toEqual({n:0});
});
it('requires replacement consent before sending bytes and rejects concurrent overwrite',async()=>{
 let t=await prepare();await patch(t.id,body);await finishTransfer(t.id,eventId,actor);
 const b=await sharp(body).modulate({brightness:.7}).jpeg().toBuffer();const c=await sharp(body).modulate({brightness:1.2}).jpeg().toBuffer();
 await expect(prepare(b)).rejects.toMatchObject({status:409});const pending=await prepare(b,{replacement:'replace'});const newer=await prepare(c,{replacement:'replace'});
 await patch(pending.id,b);await patch(newer.id,c);await finishTransfer(newer.id,eventId,actor);
 await expect(finishTransfer(pending.id,eventId,actor)).rejects.toMatchObject({status:409});expect(sqlite.prepare('select sha256 from photo_files').get()).toEqual({sha256:sha(c)});
});

import {randomUUID} from 'node:crypto';
import {createCollection,addPhotosToCollections} from './grouping';
import {organizationState,saveRecoverableOrganization,undoOrganization} from './organization-recovery';
it('checks stale sorting baselines and undoes only unchanged acknowledged saves',async()=>{
 const t=await prepare();await patch(t.id,body);const photo=(await finishTransfer(t.id,eventId,actor)).photoId;
 const target=createCollection(eventId,'Kid A'),other=createCollection(eventId,'Kid B');
 const plan={requestId:randomUUID(),revision:organizationState(eventId,[photo]).revision,photoIds:[photo],targets:[{kind:'existing',galleryId:target,photoIds:[photo]}]};
 const result=saveRecoverableOrganization(eventId,actor,plan);expect(saveRecoverableOrganization(eventId,actor,plan)).toEqual(result);
 expect(()=>saveRecoverableOrganization(eventId,actor+1,plan)).toThrow('identifier');
 expect(()=>saveRecoverableOrganization(eventId,actor,{...plan,requestId:randomUUID()})).toThrow('changed');
 expect(undoOrganization(eventId,actor,result.actionId)).toEqual({undone:true});expect(undoOrganization(eventId,actor,result.actionId)).toEqual({undone:true});
 expect(sqlite.prepare('SELECT gallery_id FROM gallery_photos WHERE photo_id=?').all(photo)).toEqual([{gallery_id:galleryId}]);
 const next=saveRecoverableOrganization(eventId,actor,{...plan,requestId:randomUUID(),revision:organizationState(eventId,[photo]).revision});
 addPhotosToCollections(eventId,[photo],[other]);expect(()=>undoOrganization(eventId,actor,next.actionId)).toThrow('changed after');
 expect(sqlite.prepare('select count(*) n from photo_files').get()).toEqual({n:1});
});
it('never lets a draft claim unrelated photos or replay an undone action',async()=>{
 const t=await prepare();await patch(t.id,body);const photo=(await finishTransfer(t.id,eventId,actor)).photoId;
 const plan={requestId:randomUUID(),revision:organizationState(eventId,[photo]).revision,photoIds:[photo],targets:[{kind:'new',key:randomUUID(),label:'New child',photoIds:[photo]}]};
 expect(()=>saveRecoverableOrganization(eventId,actor,{...plan,targets:[{...plan.targets[0],photoIds:[999999]}]})).toThrow('belong');
 const result=saveRecoverableOrganization(eventId,actor,plan);undoOrganization(eventId,actor,result.actionId);expect(()=>saveRecoverableOrganization(eventId,actor,plan)).toThrow('undone');
});
