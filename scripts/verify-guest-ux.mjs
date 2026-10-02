// Isolated guest UX rehearsal. Native sharing is mocked; physical iPhone Save to Photos is not asserted.
// Run after npm run build: node scripts/verify-guest-ux.mjs
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
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-guest-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.GUEST_ARTIFACTS;
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
 const ids=[];for(const n of Array.from({length:24},(_,i)=>i+1)){r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`IMG_${n}.jpg`,role:'print'}),{method:'PUT',body:full,headers:{'content-type':'application/octet-stream'}});assert.equal(r.status,200);ids.push((await r.json()).photoId);}await waitReady(ids);
 const collection=db.prepare("INSERT INTO galleries(event_id,public_id,name,sort_order,created_at) VALUES(?,'payment-fixture','Test collection',1,?)").run(eventId,new Date().toISOString()).lastInsertRowid;
 for(const id of ids.slice(0,20))db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,id);
 db.prepare('DELETE FROM gallery_photos WHERE gallery_id=?').run(intake);
 db.prepare('UPDATE events SET is_published=1,ordering_enabled=1 WHERE id=?').run(eventId);
 const setting=(key,value)=>db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify({v:value}),new Date().toISOString());
 setting('venmoHandle',' @fixture-account ');setting('paymentInstructionsMd','Cash can be given to the photographer.');
 const ev=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
 if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});

 const sibling=db.prepare("INSERT INTO galleries(event_id,public_id,name,sort_order,created_at) VALUES(?,'sibling-fixture','PRIVATE second child',2,?)").run(eventId,new Date().toISOString()).lastInsertRowid;
 for(const id of [ids[0],...ids.slice(21)])db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(sibling,id);
 assert.equal(db.prepare('SELECT subject_label FROM events WHERE id=?').get(eventId).subject_label,'Order reference');
 const settingsContext=await browser.newContext({viewport:{width:1280,height:900}});
 await settingsContext.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
 const settingsPage=await settingsContext.newPage();
 await settingsPage.goto(base+`/admin/events/${eventId}`,{waitUntil:'networkidle'});
 await settingsPage.getByRole('tab',{name:'Settings',exact:true}).click();
 await settingsPage.getByLabel('Order reference label',{exact:false}).fill('Participant name');
 await settingsPage.getByRole('button',{name:'Save project settings',exact:true}).click();
 await expect.poll(()=>db.prepare('SELECT subject_label FROM events WHERE id=?').get(eventId).subject_label).toBe('Participant name');
 await settingsPage.reload({waitUntil:'networkidle'});await settingsPage.getByRole('tab',{name:'Settings',exact:true}).click();
 await expect(settingsPage.getByLabel('Order reference label',{exact:false})).toHaveValue('Participant name');
 await settingsContext.close();ok('Project settings save and reload a custom order-reference label');
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const outbound=[];await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(outbound.push(route.request().url()),route.abort()));
 await ctx.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>!!files?.length});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.sharedFiles={active:navigator.userActivation.isActive,files:await Promise.all(files.map(async f=>({name:f.name,type:f.type,size:f.size,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))})))};}});});
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 const album=`${base}/g/${ev.slug}`, galleryUrl=album+'/c/payment-fixture';
 await page.goto(album,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Save collection 1'}).click();
 await expect(page.getByRole('region',{name:'Saved collections',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Open saved collection 1'}).click();await page.waitForLoadState('networkidle');
 await expect(page.getByRole('button',{name:'Remove saved collection'})).toHaveAttribute('aria-pressed','true');
 const last=page.locator('[data-guest-photo]').nth(14);await last.scrollIntoViewIfNeeded();await delay(450);
 const position=await page.evaluate(id=>JSON.parse(localStorage.getItem(`pk_family_${id}`)),eventId);assert.ok(Object.values(position.positions).some(p=>p.y>400));
 await page.reload({waitUntil:'networkidle'});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(400);
 db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,ids[20]);
 await page.goto(album,{waitUntil:'networkidle'});await expect(page.getByText('1 new since your visit',{exact:true})).toBeVisible();
 assert.ok(!(await page.content()).includes('PRIVATE second child'));await shot('family-mobile');
 ok('Family pins survive reload, restore browsing position, count actual new arrivals and keep private collection names private');
 await page.goto(galleryUrl,{waitUntil:'networkidle'});await page.evaluate(()=>scrollTo(0,0));
 await page.locator('[data-guest-photo]').first().getByRole('button',{name:/Download/}).click();
 let sheet=page.getByRole('dialog');
 await sheet.getByRole('button',{name:'Prepare photo',exact:true}).click();await expect(sheet.getByRole('button',{name:'Open share sheet'})).toBeVisible();
 await sheet.getByRole('button',{name:'Open share sheet'}).click();await expect.poll(()=>page.evaluate(()=>!!window.sharedFiles)).toBe(true);const shared=await page.evaluate(()=>window.sharedFiles);
 assert.equal(shared.active,true);assert.equal(shared.files.length,1);assert.equal(shared.files[0].type,'image/jpeg');assert.deepEqual(Buffer.from(shared.files[0].bytes),full);
 await expect(sheet.getByText(/Handed to your device/)).toBeVisible();await shot('phone-save-mobile');
 await sheet.getByRole('button',{name:/^Close Download/}).click();

 await page.locator('[data-guest-photo]').first().getByRole('button',{name:/Download/}).click();
 let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/file/*',async route=>{await gate;await route.fulfill({status:200,contentType:'image/jpeg',body:full}).catch(()=>{});});
 await sheet.getByRole('button',{name:'Prepare photo',exact:true}).click();await expect(sheet.getByRole('progressbar',{name:'Preparing photos'})).toBeVisible();await sheet.getByRole('button',{name:'Cancel preparation'}).click();await expect(sheet.getByRole('alert')).toContainText('Preparation stopped');release();await page.unroute('**/file/*');
 await page.route('**/file/*',route=>route.fulfill({status:503,body:'temporarily unavailable'}));await sheet.getByRole('button',{name:'Prepare photo',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('not available');await expect(sheet.getByRole('button',{name:/Download files/})).toBeEnabled();await page.unroute('**/file/*');await sheet.getByRole('button',{name:/^Close Download/}).click();
 ok('Canceled and failed phone preparation keeps the normal download fallback usable');
 await page.getByRole('button',{name:'Download all photos',exact:true}).click();
 await sheet.getByText(/Download in smaller parts/).click();await expect(sheet.getByRole('button',{name:/^Part /})).toHaveCount(2);
 const downloadPromise=page.waitForEvent('download');await sheet.getByRole('button',{name:/^Part 2 /}).click();const dl=await downloadPromise;assert.equal(await dl.failure(),null);
 await expect(sheet.getByRole('button',{name:/^Part 2 .*Started/})).toBeVisible();
 await page.route('**/api/zip',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})}));await sheet.getByRole('button',{name:/^Part 1 /}).click();await expect(sheet.getByRole('alert')).toContainText('choices have been kept');await expect(sheet.getByRole('button',{name:/^Part 1 /})).not.toContainText('Started');await page.unroute('**/api/zip');
 const zipPromise=page.waitForEvent('download');await sheet.getByRole('button',{name:/^Part 1 /}).click();const zip=await zipPromise;const archive=path.join(scratch,'part-one.zip');await zip.saveAs(archive);const listing=spawnSync('unzip',['-Z1',archive],{encoding:'utf8'});assert.equal(listing.status,0);assert.equal(listing.stdout.trim().split('\n').length,20);
 await sheet.getByRole('button',{name:/^Close Download/}).click();ok('Native JPEG preparation preserves exact bytes and user activation; large selections split into independently downloadable parts');
 // A browser without native sharing retains the existing file/ZIP download controls.
 await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
 await page.locator('[data-guest-photo]').first().getByRole('button',{name:/Download/}).click();await expect(sheet.getByRole('region',{name:'Save to your phone'})).toHaveCount(0);await expect(sheet.getByRole('button',{name:/Download files/})).toBeEnabled();await sheet.getByRole('button',{name:/^Close Download/}).click();
 ok('Unsupported share-sheet APIs retain working browser downloads');
 // Build an existing cart first; then add favorites from two collections, one shared.
 await page.goto(galleryUrl+`/order?photo=${ids[1]}`,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Add',exact:true}).last().click();await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.evaluate(({eventId,ids})=>localStorage.setItem(`pk_favorites_${eventId}`,JSON.stringify([ids[0],ids[22]])),{eventId,ids});
 await page.goto(galleryUrl+'/order?favorites=1',{waitUntil:'networkidle'});
 const favoriteCards=page.getByRole('region',{name:'Favorite prints'}).getByRole('article');
 await expect(favoriteCards).toHaveCount(2);await favoriteCards.first().getByLabel('Quantity').fill('2');await favoriteCards.first().getByRole('button',{name:'Add to order',exact:true}).click();
 await favoriteCards.last().getByRole('button',{name:'Add to order',exact:true}).click();
 await shot('favorites-mobile');await page.setViewportSize({width:1280,height:960});await shot('favorites-desktop');await page.setViewportSize({width:390,height:844});
 const saved=await page.evaluate(id=>JSON.parse(localStorage.getItem(`pk_cart_${id}`)),eventId);assert.equal(saved.items.length,3);assert.equal(saved.items.reduce((n,i)=>n+i.quantity,0),4);assert.equal(saved.items[0].sheets[0].cells[0].photoId,ids[1]);
 await page.getByRole('button',{name:'Review order',exact:true}).click();await page.getByRole('button',{name:'Checkout',exact:true}).click();
 await expect(page.getByLabel('Participant name (optional)',{exact:true})).toBeVisible();await page.getByLabel('Participant name (optional)',{exact:true}).fill('Demo participant');
 await page.getByLabel('Your name').fill('Synthetic customer');await page.getByLabel('Phone',{exact:true}).fill('555-0100');
 await page.getByText('Requests for specific photos (optional)',{exact:true}).click();await page.getByLabel(`Request for Photo ${ids[0]}`,{exact:true}).fill('Please keep the full frame.');await page.getByLabel(`Request for Photo ${ids[22]}`,{exact:true}).fill('Remove the small mark.');
 // Commit the first attempt but lose its response. Reload and retry must recover one order.
 let lost=false;await page.route('**/api/orders',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Place order',exact:true}).click();await expect(page.getByRole('button',{name:'Retry saved order',exact:true})).toBeVisible();
 const firstOrder=db.prepare('SELECT * FROM orders').get();assert.ok(firstOrder);assert.equal(firstOrder.subject_name,'Demo participant');assert.deepEqual(JSON.parse(firstOrder.photo_requests),{[ids[0]]:'Please keep the full frame.',[ids[22]]:'Remove the small mark.'});assert.equal(firstOrder.email_updates,0);
 await page.reload({waitUntil:'networkidle'});await expect(page.getByRole('button',{name:'Retry saved order',exact:true})).toBeVisible();await page.getByRole('button',{name:'Retry saved order',exact:true}).click();await page.waitForURL('**/o/**');await page.waitForLoadState('networkidle');
 assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM order_items').get().n,3);assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
 await expect(page.getByRole('region',{name:'Your photo requests'}).getByText('Please keep the full frame.')).toBeVisible();
 const deliveryId=db.prepare("INSERT INTO notification_deliveries(event_type,recipient,payload,status,attempts,created_at) VALUES('order.created','parent_email:test@example.invalid',?,'dead',0,?)").run(JSON.stringify({data:{orderId:firstOrder.id}}),new Date().toISOString()).lastInsertRowid;
 const ownerHtml=await (await request(`/admin/orders/${firstOrder.id}`)).text();
 assert.match(ownerHtml,/by customer/);assert.doesNotMatch(ownerHtml,/by parent/);
 assert.match(ownerHtml,/via customer email/);assert.doesNotMatch(ownerHtml,/via parent_email/);
 db.prepare('DELETE FROM notification_deliveries WHERE id=?').run(deliveryId);
 assert.ok(ownerHtml.includes('Participant name'));assert.ok(ownerHtml.includes('Please keep the full frame.')&&ownerHtml.includes('Customer request'));
 const sources=await request(`/admin/api/orders/${firstOrder.id}/print-files?purpose=review`);assert.equal(sources.status,200);const sourcePath=path.join(scratch,'sources.zip');await writeFile(sourcePath,Buffer.from(await sources.arrayBuffer()));const pickList=spawnSync('unzip',['-p',sourcePath,'*/pick-list.txt'],{encoding:'utf8'}).stdout;assert.match(pickList,/Customer request: Please keep the full frame/);assert.match(pickList,/Remove the small mark/);
 ok('Favorite siblings deduplicate shared shots, preserve the existing cart and retain per-photo requests across a committed-but-lost order response and reload');
 const tracker=page.getByRole('region',{name:'Order progress'});await expect(tracker.locator('[aria-current="step"]')).toHaveText(/Received/i);
 db.prepare("INSERT INTO order_photo_work(order_id,photo_key,state,note,updated_at) VALUES(?,?,'needs_touchup','PRIVATE preparation instruction',?)").run(firstOrder.id,`photo:${ids[0]}`,new Date().toISOString());
 await tracker.getByRole('button',{name:'Refresh status'}).click();await expect(tracker.locator('[aria-current="step"]')).toHaveText(/Preparing/i);
 db.prepare('UPDATE events SET pickup_instructions=? WHERE id=?').run('Collect at the school reception after Wednesday.',eventId);db.prepare("UPDATE orders SET status='printed' WHERE id=?").run(firstOrder.id);
 await tracker.getByRole('button',{name:'Refresh status'}).click();await expect(tracker.locator('[aria-current="step"]')).toHaveText(/Printed/i);await expect(tracker.getByText('Collect at the school reception after Wednesday.')).toBeVisible();await expect(page.getByRole('heading',{name:'Pay cash in person'})).toBeVisible();
 assert.ok(!(await page.content()).includes('PRIVATE preparation instruction'));assert.ok(!(await page.content()).includes('PRIVATE second child'));
 await shot('order-tracker-mobile');
 db.prepare("UPDATE orders SET status='delivered' WHERE id=?").run(firstOrder.id);await tracker.getByRole('button',{name:'Refresh status'}).click();await expect(tracker.locator('[aria-current="step"]')).toHaveText(/Delivered/i);assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
 db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(firstOrder.id);await tracker.getByRole('button',{name:'Refresh status'}).click();await expect(tracker).toHaveCount(0);await expect(page.getByText(/Please do not send payment/)).toBeVisible();
 ok('Parent tracking follows preparation through delivery, keeps payment separate, shows pickup instructions and excludes private owner notes');
 // Enable only a non-routable loopback mail endpoint for preference UI. No notification events are generated here.
 db.prepare("UPDATE orders SET status='new',email='parent@example.invalid' WHERE id=?").run(firstOrder.id);
 setting('smtp',{host:'127.0.0.1',port:1,secure:false,user:'',pass:'',from:'fixture@example.invalid'});
 await page.reload({waitUntil:'networkidle'});await tracker.getByLabel('Email me when prints are printed or delivered').check();await tracker.getByRole('button',{name:'Save email preference'}).click();await expect(tracker.getByRole('status')).toHaveText('Email preference saved.');assert.equal(db.prepare('SELECT email_updates FROM orders').get().email_updates,1);
 await tracker.getByLabel('Email me when prints are printed or delivered').uncheck();await tracker.getByRole('button',{name:'Save email preference'}).click();await expect.poll(()=>db.prepare('SELECT email_updates FROM orders').get().email_updates).toBe(0);
 setting('smtp',null);ok('Order-token email preference can opt in and out without changing the purchase or sending mail');
 // Existing publication/access checks still protect both files and family/gallery JSON.
 db.prepare('UPDATE events SET is_published=0 WHERE id=?').run(eventId);
 assert.notEqual((await request(`/g/${ev.slug}/api/photos?g=payment-fixture`,{},false)).status,200);
 const file=db.prepare("SELECT id FROM photo_files WHERE photo_id=? AND role='print'").get(ids[0]);assert.notEqual((await request(`/g/${ev.slug}/file/${file.id}`,{},false)).status,200);
 assert.deepEqual(outbound,[]);assert.deepEqual(pageErrors,[]);ok('Unpublished albums do not expose family data or downloadable files; no external requests or browser errors');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots,limitation:'Native sharing mocked in Chromium. Physical iPhone Photos destination not verified.'},null,2));
}catch(error){if(page&&artifactDir)await shot('failure',page).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
