import {beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('./db',async()=>{
 const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');
 const schema=await import('./db/schema');const {MIGRATIONS}=await import('./db/migrations');
 const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);
 return {sqlite,schema,db:drizzle(sqlite,{schema})};
});
vi.mock('./notify',()=>({emitDomainEvent:vi.fn(),scheduleDeliveries:vi.fn()}));
vi.mock('./blob-store',()=>({objectStat:vi.fn()}));
import {sqlite} from './db';
import {getOrderDetail} from './orders';
import {fulfillment,updateFulfillment,type WorkAction} from './fulfillment';
import {objectStat} from './blob-store';
import {emitDomainEvent} from './notify';
import {approvePrintMasters} from './production-approval';
const first='a'.repeat(64),second='b'.repeat(64),corrected='c'.repeat(64);
function state(id=1){return fulfillment(getOrderDetail(id)!);}
function save(action:WorkAction,id=1){return updateFulfillment(id,action,state(id).revision,randomUUID(),'owner');}
async function readyAll(){for(const p of state().photos)await save({kind:'photo',photoKey:p.key,state:'ready',note:'Reviewed in Lightroom'});await save({kind:'resolve_requests'});}
beforeEach(()=>{
 vi.clearAllMocks();sqlite.pragma('foreign_keys=OFF');for(const r of sqlite.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as {name:string}[])sqlite.exec(`DELETE FROM ${r.name}`);sqlite.pragma('foreign_keys=ON');
 sqlite.exec(`INSERT INTO events(id,slug,name,variant_policy,created_at,updated_at) VALUES(1,'fixture','Fixture','{}','now','now');
 INSERT INTO galleries(id,event_id,public_id,name,created_at) VALUES(1,1,'fixture','Child','now');
 INSERT INTO photos(id,gallery_id,stem,display_name,created_at,updated_at) VALUES(1,1,'IMG_01','IMG_01','now','now'),(2,1,'IMG_02','IMG_02','now','now');
 INSERT INTO photo_files(id,photo_id,role,original_filename,ext,mime,bytes,sha256,storage_path,created_at) VALUES(1,1,'print','IMG_01.jpg','jpg','image/jpeg',100,'${first}','originals/a.jpg','now'),(2,2,'print','IMG_02.jpg','jpg','image/jpeg',100,'${second}','originals/b.jpg','now');
 INSERT INTO orders(id,order_number,access_token,idempotency_key,event_id,customer_name,notes,subtotal_cents,total_cents,currency,created_at,updated_at) VALUES(1,'TEST-1','test-token','test-idem',1,'Synthetic','Please remove the mark',1000,1000,'USD','now','now');
 INSERT INTO order_items(id,order_id,product_code,product_name,product_kind,quantity,unit_price_cents,total_cents) VALUES(1,1,'SET','Set','package',2,500,1000);
 INSERT INTO order_item_sheets(id,order_item_id,sheet_index,template_code,label,paper_width_in,paper_height_in) VALUES(1,1,0,'SHEET','Sheet',8.5,11);
 INSERT INTO order_item_cells(id,order_item_sheet_id,cell_index,print_size_code,label,w_in,h_in,x_in,y_in,photo_id,photo_stem,gallery_name,print_sha256) VALUES(1,1,0,'5x7','A',5,7,0,0,1,'IMG_01','Child','${first}'),(2,1,1,'4x6','B',4,6,0,0,1,'IMG_01','Child','${first}'),(3,1,2,'5x7','C',5,7,0,0,2,'IMG_02','Child','${second}');`);
 vi.mocked(objectStat).mockImplementation(async(path)=>{const f=sqlite.prepare('SELECT bytes,sha256 FROM photo_files WHERE storage_path=?').get(path) as {bytes:number;sha256:string};return {size:f.bytes,sha256:f.sha256};});
});
afterAll(()=>sqlite.close());
describe('owner print fulfillment',()=>{
 it('keeps photo-specific customer requests separate from private notes and invalidates an old acknowledgment',async()=>{
  await readyAll();expect(state().requestsAddressed).toBe(true);
  sqlite.prepare('UPDATE orders SET photo_requests=? WHERE id=1').run(JSON.stringify({'1':'Crop slightly wider'}));
  expect(state().requestsAddressed).toBe(false);expect(state().photos[0]).toMatchObject({parentNote:'Crop slightly wider',note:'Reviewed in Lightroom'});
  await save({kind:'resolve_requests'});expect(state().requestsAddressed).toBe(true);
  sqlite.prepare('UPDATE orders SET photo_requests=? WHERE id=1').run(JSON.stringify({'1':'Keep the whole frame'}));expect(state().requestsAddressed).toBe(false);
 });
 it('starts existing orders in review without rewriting their purchased selections',()=>{
  expect(state()).toMatchObject({stage:'review',requestsAddressed:false,reviewed:0});expect(state().photos).toHaveLength(2);
  expect(state().photos[0].prints).toEqual([{size:'5x7',count:2},{size:'4x6',count:2}]);
  expect(sqlite.prepare('SELECT count(*) n FROM order_events').get()).toEqual({n:0});
 });
 it('requires requests and every photo, keeps payment separate, and replays a lost printed response once',async()=>{
  await expect(save({kind:'status',to:'printed'})).rejects.toMatchObject({status:409});
  for(const p of state().photos)await save({kind:'photo',photoKey:p.key,state:'ready',note:'Done'});
  expect(state().stage).toBe('review');await save({kind:'resolve_requests'});expect(state().stage).toBe('ready');
  expect(emitDomainEvent).not.toHaveBeenCalled();
  const revision=state().revision,id=randomUUID(),action:WorkAction={kind:'status',to:'printed'};
  await updateFulfillment(1,action,revision,id,'owner');expect((await updateFulfillment(1,action,revision,id,'owner')).replay).toBe(true);
  expect(getOrderDetail(1)!.paidCents).toBe(0);expect(getOrderDetail(1)!.order.status).toBe('printed');
  expect(emitDomainEvent).toHaveBeenCalledTimes(1);
  await save({kind:'status',to:'delivered'});expect(state().stage).toBe('delivered');expect(getOrderDetail(1)!.paidCents).toBe(0);
 });
 it('tracks touch-ups and requires new review after a corrected master is explicitly approved',async()=>{
  await save({kind:'photo',photoKey:'photo:1',state:'needs_touchup',note:'Remove mark'});expect(state().stage).toBe('touchups');await readyAll();
  const revision=state().revision;sqlite.prepare('UPDATE photo_files SET sha256=? WHERE id=1').run(corrected);
  expect(state().photos[0]).toMatchObject({stale:true,state:'needs_review'});expect(getOrderDetail(1)!.items[0].sheets[0].cells[0].printSha256).toBe(first);
  await expect(updateFulfillment(1,{kind:'photo',photoKey:'photo:1',state:'ready',note:''},revision,randomUUID(),'owner')).rejects.toMatchObject({status:409});
  await approvePrintMasters(1,[{cellId:1,sha256:corrected},{cellId:2,sha256:corrected}],'owner','Final touch-up');
  expect(state().stage).toBe('review');await save({kind:'photo',photoKey:'photo:1',state:'ready',note:'Corrected master reviewed'});expect(state().stage).toBe('ready');
  expect(getOrderDetail(1)!.events.find(e=>e.type==='print_masters_approved')!.data).toMatchObject({changes:[{before:first,after:corrected},{before:first,after:corrected}]});
 });
 it('makes new requests pending and prevents stale tabs overwriting notes',async()=>{
  await readyAll();const old=state().revision;
  await save({kind:'requests',notes:'Parent asked for matte paper by message'});expect(state()).toMatchObject({stage:'review',requestsAddressed:false});
  await expect(updateFulfillment(1,{kind:'requests',notes:'stale'},old,randomUUID(),'owner')).rejects.toMatchObject({status:409});
  expect(state().extraRequests).toContain('matte');await save({kind:'resolve_requests'});expect(state().stage).toBe('ready');
 });
 it('rejects cancelled edits and reopens with fresh reviews while retaining notes',async()=>{
  await readyAll();await save({kind:'status',to:'cancelled'});
  await expect(save({kind:'photo',photoKey:'photo:1',state:'ready',note:'bad'})).rejects.toMatchObject({status:409});
  await save({kind:'status',to:'new'});expect(state()).toMatchObject({stage:'review',reviewed:0,requestsAddressed:false});expect(state().photos[0].note).toBe('Reviewed in Lightroom');
 });
 it('does not authorize a file or requests changed during remote availability checks',async()=>{
  vi.mocked(objectStat).mockImplementationOnce(async()=>{sqlite.prepare('UPDATE photo_files SET sha256=? WHERE id=1').run(corrected);return {size:100,sha256:first};});
  await expect(save({kind:'photo',photoKey:'photo:1',state:'ready',note:''})).rejects.toMatchObject({status:409});expect(state().reviewed).toBe(0);
 });
 it('holds missing files and prevents marking unrelated photos ready',async()=>{
  vi.mocked(objectStat).mockRejectedValue(new Error('Missing fixture file'));
  await expect(save({kind:'photo',photoKey:'photo:1',state:'ready',note:''})).rejects.toMatchObject({status:409});
  await expect(save({kind:'photo',photoKey:'photo:99',state:'needs_touchup',note:''})).rejects.toMatchObject({status:404});expect(state().reviewed).toBe(0);
 });
 it('rejects reusing a completed intent for different work and keeps history exactly once',async()=>{
  const id=randomUUID(),revision=state().revision,action:WorkAction={kind:'requests',notes:'Private instruction'};
  await updateFulfillment(1,action,revision,id,'owner');expect((await updateFulfillment(1,action,revision,id,'owner')).replay).toBe(true);
  await expect(updateFulfillment(1,{kind:'requests',notes:'Different'},revision,id,'owner')).rejects.toMatchObject({status:409});
  expect(sqlite.prepare("SELECT count(*) n FROM order_events WHERE type='special_requests'").get()).toEqual({n:1});
 });
});
