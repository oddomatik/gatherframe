import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';

vi.mock('./env', () => ({ env: { secret: 'isolated-trust-test-secret', publicOrigin: 'https://fixture.invalid', isProd: false }, nowIso: () => new Date().toISOString() }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
vi.mock('./workers', () => ({ startWorkers: vi.fn() }));
vi.mock('./notify', () => ({ emitDomainEvent: vi.fn(), scheduleDeliveries: vi.fn() }));

import { db, schema, sqlite } from './db';
import { createOrder, recordPayment, deletePayment, getOrderDetail, listOrders, orderSummary } from './orders';
import { createEvent, createGalleries, listGalleries, listPhotos } from './events';
import { seedCatalog, eventCatalog } from './catalog';
import { quoteCart } from './quote';
import { mediaUrl, validMediaToken, visiblePhoto } from './media-access';
import { eventAccessState, grantEventAccess, visitorSid } from './access';
import { publicPhotos } from './public';
import { priceCart, type CartItem } from '$shared/pricing';
import { handle } from '../../hooks.server';

const jar = () => {
  const values = new Map<string,string>();
  return { get: (k: string) => values.get(k), set: (k: string,v: string) => values.set(k,v), delete: (k: string) => values.delete(k) } as unknown as Cookies;
};
let event: typeof schema.events.$inferSelect;
let photoId: number, galleryId: number;
let cart: CartItem[];
const customer = { name: 'Test Parent', email: 'parent@example.test', subjectName: 'Child and friend' };
const sid = 'test-visitor-123456';
const key = 'exact-intent-123456';
function currentQuote() { return quoteCart(event.id, sid, cart, eventCatalog(event.id, event.catalogId).catalog); }
function input() { return { event, cart, customer, idempotencyKey: key, sid, ip: null, quoteToken: currentQuote().quoteToken }; }

beforeEach(() => {
  for (const table of ['notification_deliveries','jobs','order_events','order_item_cells','order_item_sheets','order_items','payments','orders','photo_files','photos','galleries','event_products','events','product_sheets','products','sheet_template_cells','sheet_templates','print_sizes','catalogs']) sqlite.exec(`DELETE FROM ${table}`);
  seedCatalog();
  event = createEvent({ name: 'A playful afternoon' });
  db.update(schema.events).set({ isPublished: 1 }).where(eq(schema.events.id,event.id)).run(); event.isPublished = 1;
  createGalleries(event.id,['PRIVATE LABEL']); galleryId=listGalleries(event.id)[0].id;
  photoId=db.insert(schema.photos).values({ galleryId,stem:'PRIVATE-NAME-7',displayName:'PRIVATE NAME',renditionStatus:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() }).returning().get().id;
  db.insert(schema.galleryPhotos).values({galleryId,photoId}).run();
  const catalog=eventCatalog(event.id,event.catalogId).catalog;
  const p=catalog.products.find((p)=>p.code==='single_8x10')!;
  cart=[{key:'chosen-print',productId:p.id,quantity:1,sheets:[{templateCode:p.sheets[0].templateCode,cells:[{cellIndex:0,photoId}]}]}];
  vi.clearAllMocks();
});
afterAll(()=>sqlite.close());

describe('accepted ordering and replay',()=>{
  it('preserves pre-upgrade retry hashes and freezes new photo requests with the order',async()=>{
    const {createHash}=await import('node:crypto'); const accepted=input();
    const expected=createHash('sha256').update(JSON.stringify({cart,customer:{name:customer.name,email:customer.email,phone:null,subjectName:customer.subjectName,notes:null}})).digest('hex');
    const old=createOrder(accepted).order;expect(old.intentHash).toBe(expected);
    expect(createOrder({...accepted,customer:{...customer,photoRequests:{},emailUpdates:false}}).replay).toBe(true);
    const updated={...input(),idempotencyKey:'photos-specific-intent',customer:{...customer,photoRequests:{[photoId]:' Remove mark '},emailUpdates:true}};
    const first=createOrder(updated);expect(first.order.photoRequests).toEqual({[photoId]:'Remove mark'});expect(first.order.emailUpdates).toBe(1);
    expect(createOrder(updated).replay).toBe(true);
    expect(()=>createOrder({...updated,customer:{...updated.customer,photoRequests:{[photoId]:'Different crop'}}})).toThrow(/different details/);
  });
  it('rejects requests for photos outside the purchase and email updates without email',()=>{
    expect(()=>createOrder({...input(),customer:{...customer,photoRequests:{9999:'Wrong photo'}}})).toThrow(/selected prints/);
    expect(()=>createOrder({...input(),customer:{...customer,photoRequests:{[photoId]:'x'.repeat(501)}}})).toThrow(/photo requests/);
    expect(()=>createOrder({...input(),customer:{name:'Test',phone:'555',emailUpdates:true}})).toThrow(/email address/);
    expect(db.select().from(schema.orders).all()).toHaveLength(0);
  });
  it('requires reviewed prices; price changes cannot silently change a saved order',()=>{
    const initial=input();
    db.update(schema.products).set({priceCents:4321}).where(eq(schema.products.id,cart[0].productId)).run();
    expect(()=>createOrder(initial)).toThrow(/changed/);
    expect(db.select().from(schema.orders).all()).toHaveLength(0);
    const accepted=input(); const first=createOrder(accepted);
    expect(first.order.totalCents).toBe(4321);
    db.update(schema.products).set({priceCents:9999}).where(eq(schema.products.id,cart[0].productId)).run();
    expect(createOrder({...accepted,event:{...event,orderingEnabled:0}}).order.id).toBe(first.order.id);
    expect(db.select().from(schema.orders).all()).toHaveLength(1);
  });
  it('requires a fresh review after a selected photo file changes even at the same price',()=>{
    const accepted=input();
    db.update(schema.photos).set({renditionHash:'a-new-preview'}).where(eq(schema.photos.id,photoId)).run();
    expect(()=>createOrder(accepted)).toThrow(/changed/);
    expect(db.select().from(schema.orders).all()).toHaveLength(0);
  });
  it('cannot reuse a saved attempt with different contact/cart or another visitor',()=>{
    const accepted=input(); createOrder(accepted);
    expect(()=>createOrder({...accepted,customer:{...customer,name:'Another Parent'}})).toThrow(/different details/);
    expect(()=>createOrder({...accepted,sid:'another-visitor'})).toThrow(/different details/);
    expect(()=>createOrder({...accepted,cart:[{...cart[0],quantity:2}]})).toThrow(/different details/);
  });
  it('does not infer public child names from private labels and refuses private intake photos',()=>{
    expect(createOrder({...input(),customer:{...customer,subjectName:''}}).order.subjectName).toBeNull();
    db.update(schema.galleries).set({isIntake:1}).where(eq(schema.galleries.id,galleryId)).run();
    expect(()=>createOrder({...input(),idempotencyKey:'new-intake-intent'})).toThrow(/not part/);
  });
  it('rejects non-unique line IDs and invalid print slots or sizes',()=>{
    const catalog=eventCatalog(event.id,event.catalogId).catalog;
    expect(priceCart([...cart,...cart],catalog).complete).toBe(false);
    expect(priceCart([{...cart[0],sheets:[{...cart[0].sheets[0],cells:[{cellIndex:88,photoId}]}]}],catalog).complete).toBe(false);
    expect(priceCart([{...cart[0],sheets:[{...cart[0].sheets[0],cells:[{cellIndex:0,photoId,sizeChoice:'12x18'}]}]}],catalog).complete).toBe(false);
    const product=catalog.products.find(p=>p.code==='pkg_deluxe')!;
    const sheet=catalog.sheets[product.sheets[0].templateCode];
    const dup=[{key:'duplicate-slots',productId:product.id,quantity:1,sheets:[{templateCode:sheet.code,cells:sheet.cells.map(()=>({cellIndex:0,photoId}))}]}];
    expect(priceCart(dup,catalog).complete).toBe(false);
    const onePose={...catalog,products:catalog.products.map(p=>({...p,allowMultiPose:false}))};
    const mixed=[{key:'mixed',productId:product.id,quantity:1,sheets:[{templateCode:sheet.code,cells:sheet.cells.map((c,i)=>({cellIndex:c.cellIndex,photoId:photoId+i}))}]}];
    expect(priceCart(mixed,onePose).complete).toBe(false);
  });
});

describe('photo invitations and private media',()=>{
  it('requires a photo/kind-scoped signed preview and revokes on access changes',()=>{
    const token=new URL(mediaUrl(event,photoId,'thumb'),'https://fixture.invalid').searchParams.get('t');
    expect(validMediaToken(null,event,photoId,'thumb')).toBe(false);
    expect(validMediaToken(token,event,photoId,'thumb')).toBe(true);
    expect(validMediaToken(token,event,photoId+1,'thumb')).toBe(false);
    expect(validMediaToken(token,event,photoId,'web')).toBe(false);
    expect(validMediaToken(token,{...event,isPublished:0},photoId,'thumb')).toBe(false);
    expect(validMediaToken(token,{...event,passwordHash:'new-hash'},photoId,'thumb')).toBe(false);
    expect(validMediaToken(token,{...event,slug:'new-link'},photoId,'thumb')).toBe(false);
    expect(validMediaToken(token,{...event,expiresAt:'2000-01-01'},photoId,'thumb')).toBe(false);
    db.update(schema.galleries).set({isIntake:1}).where(eq(schema.galleries.id,galleryId)).run();
    expect(validMediaToken(token,event,photoId,'thumb')).toBe(false);
  });
  it('a receipt preview works without a gallery cookie but cannot show a different photo/kind',()=>{
    const order=createOrder(input()).order;
    const token=new URL(mediaUrl(event,photoId,'thumb',null,order.id),'https://fixture.invalid').searchParams.get('t');
    expect(validMediaToken(token,event,photoId,'thumb')).toBe(true);
    expect(validMediaToken(token,event,photoId,'web')).toBe(false);
    expect(validMediaToken(token,event,photoId+1,'thumb')).toBe(false);
  });
  it('binds password authorization to the visitor and omits private names from photo payloads',()=>{
    const cookies=jar(); const v=visitorSid(cookies,false); const protectedEvent={...event,passwordHash:'synthetic-hash'};
    grantEventAccess(protectedEvent,v,cookies,false);
    expect(eventAccessState(protectedEvent,cookies,false)).toBe('ok');
    cookies.set('pk_sid','different-visitor',{path:'/'});
    expect(eventAccessState(protectedEvent,cookies,false)).toBe('locked');
    const payload=JSON.stringify(publicPhotos(listPhotos(galleryId),event.variantPolicy,event));
    expect(payload).not.toContain('PRIVATE');
  });
});

describe('admin and payments boundaries',()=>{
  it('rejects every anonymous admin mutation before action dispatch',async()=>{
    for(const path of ['/admin','/admin/settings','/admin/events/1','/admin/catalog','/admin/orders/1','/admin/api/events/1/upload']){
      const resolve=vi.fn(async()=>{ throw new Error('mutation dispatch must never execute'); });
      const request=new Request('https://fixture.invalid'+path,{method:'POST',headers:{origin:'https://fixture.invalid'}});
      const response=await handle({event:{url:new URL(request.url),request,cookies:jar(),locals:{}} as never,resolve} as never);
      expect(response.status,path).toBe(401); expect(resolve).not.toHaveBeenCalled();
    }
    expect(db.select().from(schema.orders).all()).toHaveLength(0);
  });
  it('filters unpaid orders before pagination and reports all matching totals',()=>{
    const first=createOrder(input()).order;
    for(let i=0;i<55;i++){
      const { id: _id, ...values } = first;
      const later=db.insert(schema.orders).values({...values,orderNumber:`PAGE-${i}`,accessToken:`page-token-${i}`,idempotencyKey:`page-key-${i}`}).returning().get();
      db.insert(schema.payments).values({orderId:later.id,method:'cash',amountCents:later.totalCents,paidAt:new Date().toISOString(),createdAt:new Date().toISOString()}).run();
    }
    expect(listOrders({unpaid:true}).map(o=>o.id)).toEqual([first.id]);
    expect(orderSummary({unpaid:true}).count).toBe(1);
    expect(orderSummary().count).toBe(56);
    expect(listOrders({page:2})).toHaveLength(6);
  });
  it('records one payment for an exact retry and rejects changed retries/wrong-order deletion',()=>{
    const order=createOrder(input()).order;
    const payment={method:'cash' as const,amountCents:500,actor:'test-admin',reference:'cash envelope',idempotencyKey:'pay-exact-123456'};
    recordPayment(order.id,payment); recordPayment(order.id,payment);
    expect(getOrderDetail(order.id)!.paidCents).toBe(500);
    expect(()=>recordPayment(order.id,{...payment,amountCents:700})).toThrow(/different details/);
    const saved=db.select().from(schema.payments).get()!;
    expect(()=>deletePayment(saved.id,'test-admin',order.id+1)).toThrow(/not found/);
    expect(getOrderDetail(order.id)!.paidCents).toBe(500);
    deletePayment(saved.id,'test-admin',order.id);
    expect(getOrderDetail(order.id)!.paidCents).toBe(0);
    expect(()=>recordPayment(order.id,payment)).toThrow(/was removed/);
    expect(getOrderDetail(order.id)!.events.some(e=>e.type==='payment_removed'&&e.data?.paymentId===saved.id)).toBe(true);
  });
});
