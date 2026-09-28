// Disposable production-build/browser rehearsal for checkout payment UX.
// Run after npm run build: node scripts/verify-payment-ux.mjs
// Never contacts SSH, live hosts, external services, or production data.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-payment-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.PAYMENT_ARTIFACTS;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, page, adminPage, cookie = '';
child.stdout.on('data', b => { logs = (logs + b).slice(-16000); });
child.stderr.on('data', b => { logs = (logs + b).slice(-16000); });
const checks = [], pageErrors = [], screenshots = [];
const ok = name => { checks.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const full = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#6699aa' } }).jpeg().toBuffer();
const social = await sharp(full).resize(60, 40).jpeg().toBuffer();
const updated = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#cc9955' } }).jpeg().toBuffer();
const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4" /></rdf:RDF></x:xmpmeta>');
async function request(url, options = {}, authenticated = true) {
  assert.ok(url.startsWith('/') && !url.startsWith('//'));
  return fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options,
    headers: { origin: base, accept: 'text/html', ...(authenticated && cookie ? { cookie } : {}), ...options.headers } });
}
const form = entries => ({ method: 'POST', body: new URLSearchParams(entries) });
async function shot(name, target = page) {
  if (!artifactDir) return;
  const destination = path.join(artifactDir, `${name}.png`);
  await target.screenshot({ path: destination, fullPage: false }); screenshots.push(destination);
}
async function waitReady(ids) {
  for (let i = 0; i < 200; i++) {
    const rows = db.prepare(`SELECT id,rendition_status FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const busy = db.prepare("SELECT count(*) n FROM jobs WHERE type='render_photo' AND status IN ('queued','running')").get().n;
    if (!busy && rows.length === ids.length && rows.every(row => row.rendition_status === 'ready')) return;
    if (rows.some(row => row.rendition_status === 'failed')) throw new Error('Fixture render failed: ' + JSON.stringify(rows));
    await delay(100);
  }
  throw new Error('Timed out preparing synthetic previews');
}
function visibleIds(target) {
  return target.locator('article.photo-card img').evaluateAll(images => images.map(image => Number(new URL(image.src).pathname.split('/')[2])));
}
async function assertVisible(ids) { await expect.poll(() => visibleIds(page)).toEqual(ids); }try {
 for(let i=0;i<100;i++){try{if((await request('/healthz')).ok)break;}catch{}if(i===99||child.exitCode!==null)throw Error(logs);await delay(100);}
 let r=await request('/setup',form({email:'selection@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Modifier rehearsal'}));assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
 r=await request('/admin?/create',form({name:'Selection fixture'}));const eventPath=r.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));await request(eventPath+'/upload');db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');
 const intake=db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
 const ids=[];for(const n of [2,9,10,21,30]){r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`IMG_${n}.jpg`,role:'print'}),{method:'PUT',body:full,headers:{'content-type':'application/octet-stream'}});assert.equal(r.status,200);ids.push((await r.json()).photoId);}await waitReady(ids);
 const collection=db.prepare("INSERT INTO galleries(event_id,public_id,name,sort_order,created_at) VALUES(?,'payment-fixture','Test collection',1,?)").run(eventId,new Date().toISOString()).lastInsertRowid;
 for(const id of ids)db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,id);
 db.prepare('DELETE FROM gallery_photos WHERE gallery_id=?').run(intake);
 db.prepare('UPDATE events SET is_published=1,ordering_enabled=1 WHERE id=?').run(eventId);
 const setting=(key,value)=>db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify({v:value}),new Date().toISOString());
 setting('venmoHandle',' @fixture-account ');setting('paymentInstructionsMd','Cash can be given to the photographer.');
 const ev=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
 if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:ua,permissions:['clipboard-read','clipboard-write']});
 const outbound=[];await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(outbound.push(route.request().url()),route.abort()));
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(`${base}/g/${ev.slug}/c/payment-fixture/order?photo=${ids[0]}`,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Add',exact:true}).last().click();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Checkout',exact:true}).click();
 const options=page.getByRole('region',{name:'Payment options'});
 await expect(options.getByRole('heading',{name:'Pay cash in person',exact:true})).toBeVisible();
 await expect(options.getByRole('heading',{name:'Pay with Venmo',exact:true})).toBeVisible();
 assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);
 await shot('checkout-cash-mobile');ok('Cash and Venmo visible before placing an order, without requiring prepayment');
 await page.getByLabel('Your name').fill('Synthetic parent');await page.getByLabel('Phone',{exact:true}).fill('555-0100');
 await page.getByRole('button',{name:'Place order',exact:true}).click();await page.waitForURL('**/o/**');await page.waitForLoadState('networkidle');
 const order=db.prepare('SELECT * FROM orders').get();const orderUrl=page.url();
 const fingerprint=()=>JSON.stringify(Object.fromEntries(['orders','order_items','payments'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const before=fingerprint();assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
 await expect(options.getByRole('heading',{name:'Pay cash in person',exact:true})).toBeVisible();
 assert.ok(await options.evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('[aria-label="Your selected prints"]'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 const web=options.getByRole('link',{name:'Pay with Venmo',exact:true});const app=options.getByRole('link',{name:'Open Venmo app',exact:true});
 const verifyLinks=async(target,amount)=>{
  const w=target.getByRole('link',{name:'Pay with Venmo',exact:true}),a=target.getByRole('link',{name:'Open Venmo app',exact:true});
  const wu=new URL(await w.getAttribute('href')),au=new URL(await a.getAttribute('href'));
  assert.equal(wu.origin,'https://venmo.com');assert.equal(wu.pathname,'/u/fixture-account');assert.equal(au.protocol,'venmo:');assert.equal(au.hostname,'paycharge');
  for(const u of [wu,au]){assert.equal(u.searchParams.get('amount'),(amount/100).toFixed(2));assert.equal(u.searchParams.get('txn'),'pay');assert.equal(u.searchParams.get('note'),order.order_number);}
  assert.equal(au.searchParams.get('recipients'),'fixture-account');
  for(const link of [w,a]){assert.match(await link.getAttribute('rel'),/external/);assert.notEqual(await link.getAttribute('data-sveltekit-reload'),null);}
 };
 await verifyLinks(page,order.total_cents);
 // Intercept only at the final window bubble phase, after the app router. Never invoke real payments.
 await page.evaluate(()=>{window.paymentClicks=[];window.addEventListener('click',e=>{const a=e.target.closest?.('a');if(a&&/^(venmo:|https:\/\/venmo.com)/.test(a.href)){window.paymentClicks.push({url:a.href,prevented:e.defaultPrevented,trusted:e.isTrusted});e.preventDefault();}});});
 await web.click();await app.click();const clicks=await page.evaluate(()=>window.paymentClicks);assert.equal(clicks.length,2);assert.ok(clicks.every(c=>c.trusted&&!c.prevented));assert.equal(page.url(),orderUrl);
 await options.getByText('Venmo didn’t open?',{exact:true}).click();await options.getByRole('button',{name:'Copy payment details',exact:true}).click();
 await expect(options.getByRole('status')).toHaveText('Payment details copied.');const clip=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(clip.includes(order.order_number)&&clip.includes('@fixture-account'));
 await options.getByText('Venmo didn’t open?',{exact:true}).click();await options.scrollIntoViewIfNeeded();await shot('confirmation-payment-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(fingerprint(),before);ok('iPhone-sized browser: cash precedes print list; external links preserve recipient/balance/reference and user activation; fallback copies details without payment/order mutation');
 const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844},userAgent:ua});const staticPage=await nojs.newPage();await staticPage.goto(orderUrl);await verifyLinks(staticPage,order.total_cents);await expect(staticPage.getByRole('heading',{name:'Pay cash in person'})).toBeVisible();await nojs.close();ok('Both Venmo destinations and cash render without device detection or JavaScript');
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('blocked'))},configurable:true});});
 await options.getByText('Venmo didn’t open?',{exact:true}).click();await options.getByRole('button',{name:'Copy payment details',exact:true}).click();await expect(options.getByRole('status')).toHaveText('Select the payment details above to copy them.');await expect(options.getByLabel('Payment details',{exact:true})).toHaveValue(new RegExp(order.order_number));ok('Clipboard denial retains selectable payment details');
 await page.setViewportSize({width:1280,height:900});await page.reload({waitUntil:'networkidle'});await options.scrollIntoViewIfNeeded();await shot('confirmation-payment-desktop');
 db.prepare('INSERT INTO payments(order_id,method,amount_cents,paid_at,created_at) VALUES(?,?,?,?,?)').run(order.id,'cash',100,new Date().toISOString(),new Date().toISOString());
 await page.reload({waitUntil:'networkidle'});await verifyLinks(page,order.total_cents-100);await expect(options.getByText('$1.00 recorded as paid',{exact:true})).toBeVisible();ok('Partial payment updates both Venmo links and the cash amount to the remaining balance');
 db.prepare('UPDATE payments SET amount_cents=? WHERE order_id=?').run(order.total_cents,order.id);await page.reload({waitUntil:'networkidle'});await expect(options).toHaveCount(0);await expect(page.getByText('✓ Your order is recorded as paid. Thank you!',{exact:true})).toBeVisible();
 db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(order.id);await page.reload({waitUntil:'networkidle'});await expect(options).toHaveCount(0);await expect(page.getByText(/Please do not send payment/)).toBeVisible();ok('Paid and canceled orders never invite another cash or Venmo payment');
 db.prepare("UPDATE orders SET status='new' WHERE id=?").run(order.id);db.prepare('DELETE FROM payments WHERE order_id=?').run(order.id);setting('venmoHandle','');await page.reload({waitUntil:'networkidle'});await expect(options.getByRole('heading',{name:'Pay cash in person'})).toBeVisible();await expect(options.getByRole('link')).toHaveCount(0);ok('No configured Venmo account leaves cash available without a broken payment link');
 assert.deepEqual(outbound,[]);assert.deepEqual(pageErrors,[]);ok('No external requests, real payments or browser errors');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots,limitation:'Chromium with iPhone viewport/UA; installed Venmo app launch not verified.'},null,2));
}catch(error){if(page&&artifactDir)await shot('failure',page).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
