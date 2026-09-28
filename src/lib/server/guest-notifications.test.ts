import {beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
vi.mock('./db',async()=>{const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');const schema=await import('./db/schema');const {MIGRATIONS}=await import('./db/migrations');const sqlite=new Database(':memory:');for(const m of MIGRATIONS)sqlite.exec(m.sql);return {sqlite,schema,db:drizzle(sqlite,{schema})};});
vi.mock('./mail',()=>({sendMail:vi.fn(async()=> 'local-test-receipt')}));
vi.mock('./jobs',()=>({enqueue:vi.fn()}));
import {sqlite} from './db';
import {DEFAULT_SETTINGS} from './settings';
import {emitDomainEvent,deliverPending,parentText,type OrderNotification} from './notify';
import {sendMail} from './mail';
const data:OrderNotification={orderId:1,orderNumber:'TEST',eventName:'Fixture',subjectName:null,customerName:'Parent',email:'test@example.invalid',phone:null,totalCents:1000,currency:'USD',status:'printed',lines:['PRIVATE file name'],parentLines:['1 × 5x7 Photo 2'],adminUrl:'https://fixture.invalid/admin',statusUrl:'https://fixture.invalid/o/token',venmoUrl:null,paymentInstructions:'Cash in person',notes:null,emailUpdates:true,pickupInstructions:'Collect at reception',photoRequests:{'2':'Keep full frame'}};
beforeEach(()=>{sqlite.exec('DELETE FROM notification_deliveries; DELETE FROM settings; DELETE FROM orders;');vi.clearAllMocks();sqlite.exec("INSERT OR IGNORE INTO events(id,slug,name,variant_policy,created_at,updated_at) VALUES(1,'fixture','Fixture','{}','now','now')");sqlite.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').run('smtp',JSON.stringify({v:{host:'never-contacted',port:25,user:'',pass:'',from:'test@example.invalid'}}),'now');sqlite.prepare('INSERT INTO orders(id,order_number,access_token,idempotency_key,event_id,customer_name,subtotal_cents,total_cents,currency,created_at,updated_at,email_updates) VALUES(1,\'TEST\',\'token\',\'idem\',1,\'Parent\',0,0,\'USD\',\'now\',\'now\',1)').run();});
afterAll(()=>sqlite.close());
describe('optional parent status notifications',()=>{
 it('requires opt-in for new status mail but keeps receipts, and preserves legacy preference',()=>{
  emitDomainEvent('order.status_changed',{...data,emailUpdates:false});expect(sqlite.prepare('SELECT count(*) n FROM notification_deliveries').get()).toEqual({n:0});
  emitDomainEvent('order.created',{...data,emailUpdates:false});emitDomainEvent('order.status_changed',data);emitDomainEvent('order.status_changed',{...data,emailUpdates:undefined});
  expect(sqlite.prepare('SELECT count(*) n FROM notification_deliveries').get()).toEqual({n:3});
 });
 it('honors opt-out before queued status mail sends, without suppressing the saved receipt',async()=>{
  emitDomainEvent('order.status_changed',data);emitDomainEvent('order.created',data);sqlite.exec('UPDATE orders SET email_updates=0');await deliverPending();
  expect(sendMail).toHaveBeenCalledTimes(1);expect(sqlite.prepare("SELECT status FROM notification_deliveries WHERE event_type='order.status_changed'").get()).toEqual({status:'skipped'});
 });
 it('uses customer-facing print references and pickup instructions, never private filenames',()=>{
  const text=parentText(data,'order.status_changed','Studio','Contact');expect(text).toContain('Collect at reception');expect(text).toContain('Request for Photo 2: Keep full frame');expect(text).not.toContain('PRIVATE');
 });
});
