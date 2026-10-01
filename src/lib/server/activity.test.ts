import {afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import type {RequestEvent} from '@sveltejs/kit';
vi.mock('./env',()=>({env:{secret:'isolated-test-secret'},nowIso:()=>new Date().toISOString()}));
vi.mock('./db',async()=>{
 const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');
 const schema=await import('./db/schema');const {MIGRATIONS}=await import('./db/migrations');const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);
 return {sqlite,schema,db:drizzle(sqlite,{schema})};
});
import {db,schema,sqlite} from './db';
import {POST} from '../../routes/g/[slug]/api/activity/+server';
import {activityReport,activityWindow,recordActivity,trackDownload,visitorKey} from './activity';
let eid:number,pid:number,gid:number;
const count=()=>Number((sqlite.prepare('SELECT count(*) n FROM guest_activity').get() as {n:number}).n);
function req(body:unknown,headers:Record<string,string>={},admin=false,method='POST') {
 const cookies=new Map([['pk_sid','test-session-123456789']]);const url=new URL('https://fixture.invalid/g/fixture/api/activity');
 return {url,params:{slug:'fixture'},locals:{admin:admin?{id:1}:undefined},cookies:{get:(key:string)=>cookies.get(key),set:(key:string,v:string)=>cookies.set(key,v)},request:new Request(url,{method,headers:{origin:url.origin,'content-type':'application/json','user-agent':'Safari',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})})} as unknown as RequestEvent;
}
beforeEach(()=>{
 sqlite.exec('DELETE FROM events');
 eid=db.insert(schema.events).values({slug:'fixture',name:'Fixture',variantPolicy:{print:'free'},isPublished:1,createdAt:'now',updatedAt:'now'}).returning().get().id;
 gid=db.insert(schema.galleries).values({eventId:eid,publicId:'child',name:'Private child',createdAt:'now'}).returning().get().id;
 pid=db.insert(schema.photos).values({galleryId:gid,stem:'photo',displayName:'photo',renditionStatus:'ready',createdAt:'now',updatedAt:'now'}).returning().get().id;
 db.insert(schema.galleryPhotos).values({galleryId:gid,photoId:pid}).run();
});
afterAll(()=>sqlite.close());
describe('first-party guest activity',()=>{
 it('starts empty; counts a retried event once, and separates visitors and projects',async()=>{
  expect(count()).toBe(0);const a={id:randomUUID(),kind:'favorite_add',photoId:pid};
  await POST(req(a));await POST(req(a));expect(count()).toBe(1);
  recordActivity(eid,'other',a.id,{kind:'favorite_add',photoId:pid});expect(count()).toBe(2);
  const row=sqlite.prepare('SELECT * FROM guest_activity LIMIT 1').get() as Record<string,unknown>;
  expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['ip','email','visitor_sid']));expect(row.visitor).not.toContain('test-session');
  expect(visitorKey(1,'sid')).not.toBe(visitorKey(2,'sid'));
 });
 it('requires gallery access and excludes all signed-in owner modes and known bots',async()=>{
  const a={id:randomUUID(),kind:'album_view'};
  await POST(req(a,{},true));await POST(req(a,{'user-agent':'WhatsApp preview'}));expect(count()).toBe(0);
  sqlite.prepare('UPDATE events SET password_hash=? WHERE id=?').run('protected',eid);
  await expect(POST(req(a))).rejects.toMatchObject({status:401});
  sqlite.prepare('UPDATE events SET password_hash=NULL,expires_at=? WHERE id=?').run('2000-01-01',eid);
  await expect(POST(req(a))).rejects.toMatchObject({status:410});
  sqlite.prepare('UPDATE events SET is_published=0 WHERE id=?').run(eid);
  await expect(POST(req(a))).rejects.toMatchObject({status:404});expect(count()).toBe(0);
 });
 it('rejects cross-site, huge bodies, unknown fields and unavailable references',async()=>{
  const a={id:randomUUID(),kind:'family_add',collection:'child'};
  await expect(POST(req(a,{origin:'https://other.invalid'}))).rejects.toMatchObject({status:403});
  await expect(POST(req({...a,notes:'x'.repeat(2000)}))).rejects.toMatchObject({status:413});
  await expect(POST(req({...a,email:'private@example.invalid'}))).rejects.toMatchObject({status:400});
  await expect(POST(req({...a,collection:'foreign'}))).rejects.toMatchObject({status:404});
  await expect(POST(req({id:randomUUID(),kind:'favorite_add',photoId:pid+100}))).rejects.toMatchObject({status:404});
  sqlite.prepare('UPDATE galleries SET is_intake=1 WHERE id=?').run(gid);
  await expect(POST(req(a))).rejects.toMatchObject({status:404});
  await expect(POST(req({id:randomUUID(),kind:'favorite_add',photoId:pid}))).rejects.toMatchObject({status:404});expect(count()).toBe(0);
 });
 it('counts adds and removals without claiming a current favorites inventory',async()=>{
  for(const kind of ['family_add','family_remove','collection_view'])await POST(req({id:randomUUID(),kind,collection:'child'}));
  for(const kind of ['favorite_add','favorite_remove','photo_view'])await POST(req({id:randomUUID(),kind,photoId:pid}));
  const day=new Date().toISOString().slice(0,10),report=activityReport(day,day,eid);
  expect(report.browsers).toBe(1);expect(report.collections[0]).toMatchObject({adds:1,removes:1,views:1});expect(report.photos[0]).toMatchObject({adds:1,removes:1,views:1});
  expect(activityReport('2000-01-01','2000-01-01',eid).totals).toEqual({});
  expect(activityReport(day,day,eid+1).totals).toEqual({});
 });
 it('counts complete streams, not aborts, HEADs or partial range responses',async()=>{
  const e=req(null,{},false,'GET');
  const s=Readable.from(['finished']);trackDownload(e,eid,'stream',s,{channel:'file',print:1,bytes:8});for await(const _ of s)void _;
  const partial=Readable.from(['part']);trackDownload(e,eid,'stream',partial,{channel:'range'},false);for await(const _ of partial)void _;
  const aborted=new Readable({read(){}});trackDownload(e,eid,'stream',aborted,{channel:'zip'});aborted.destroy();
  trackDownload(req(null,{},false,'HEAD'),eid,'stream',Readable.from(['x']),{channel:'file'});
  const day=new Date().toISOString().slice(0,10),report=activityReport(day,day,eid);
  expect(report.totals.download_start).toBe(3);expect(report.totals.download_complete).toBe(1);expect(report.downloads).toEqual([{channel:'file',transfers:1,social:0,print:1,raw:0,other:0,bytes:8}]);
 });
 it('separates projects and breaks mixed ZIP deliveries into actual version counts',()=>{
  const other=db.insert(schema.events).values({slug:'other',name:'Other',variantPolicy:{},createdAt:'now',updatedAt:'now'}).returning().get();
  recordActivity(eid,'same-browser','mixed',{kind:'download_complete',channel:'zip',social:2,print:2,raw:1,bytes:12000});
  recordActivity(other.id,'same-browser','other',{kind:'album_view'});
  const day=new Date().toISOString().slice(0,10),one=activityReport(day,day,eid),all=activityReport(day,day,null);
  expect(one.browsers).toBe(1);expect(all.browsers).toBe(2);expect(one.totals.album_view).toBeUndefined();
  expect(one.downloads[0]).toMatchObject({channel:'zip',transfers:1,social:2,print:2,raw:1,bytes:12000});
 });
 it('bounds date ranges to UTC and keeps reports project-scoped',()=>{
  const today=new Date('2026-09-28T22:00:00Z');
  expect(activityWindow(new URL('https://x/?from=1900-01-01&to=2099-01-01&event=3'),today)).toEqual({from:'2026-07-01',to:'2026-09-28',eventId:3});
  expect(activityWindow(new URL('https://x/?from=2026-02-31&event=NaN'),today)).toEqual({from:'2026-08-30',to:'2026-09-28',eventId:null});
 });
 it('prunes old activity on ingestion and failures never stop guest work',()=>{
  recordActivity(eid,'s',randomUUID(),{kind:'album_view'},new Date('2090-01-01'));
  recordActivity(eid,'s',randomUUID(),{kind:'album_view'},new Date('2090-06-01'));
  expect(count()).toBe(1);
  expect(()=>recordActivity(eid+10000,'s','bad',{kind:'album_view'})).not.toThrow();
 });
});
