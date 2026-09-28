// Disposable production-build/browser rehearsal for owner print fulfillment.
// Run after npm run build: node scripts/verify-fulfillment.mjs
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
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-fulfillment-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.FULFILLMENT_ARTIFACTS;
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
 const a=ids[0], b=ids[1], hash=sha256(full), now=new Date().toISOString();
 db.prepare(`INSERT INTO orders(id,order_number,access_token,idempotency_key,event_id,customer_name,notes,subtotal_cents,total_cents,currency,created_at,updated_at) VALUES(1,'TEST-WORK','test-work-token','test-work-idem',?,'Synthetic parent','Please remove mark',1000,1000,'USD',?,?)`).run(eventId,now,now);
 db.exec(`INSERT INTO order_items(id,order_id,product_code,product_name,product_kind,quantity,unit_price_cents,total_cents) VALUES(1,1,'SET','Fixture set','package',2,500,1000);
 INSERT INTO order_item_sheets(id,order_item_id,sheet_index,template_code,label,paper_width_in,paper_height_in) VALUES(1,1,0,'SHEET','Sheet',14,7);
 INSERT INTO order_item_cells(id,order_item_sheet_id,cell_index,print_size_code,label,w_in,h_in,x_in,y_in,photo_id,photo_stem,gallery_name,print_sha256) VALUES(1,1,0,'5x7','A',5,7,0,0,${a},'IMG_2','Child','${hash}'),(2,1,1,'4x6','B',4,6,5,0,${a},'IMG_2','Child','${hash}'),(3,1,2,'5x7','C',5,7,9,0,${b},'IMG_9','Child','${hash}');`);
 const ctx=await browser.newContext({viewport:{width:1365,height:1000}});
 await ctx.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
 const outbound=[];await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(outbound.push(route.request().url()),route.abort()));
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(base+'/admin/orders/1',{waitUntil:'networkidle'});
 // Landscape sources should be turned within portrait slots, not falsely marked heavily cropped.
 const originalCells=JSON.stringify(db.prepare('SELECT * FROM order_item_cells ORDER BY id').all());
 await expect(page.locator('[data-photo-rotation="90"]')).toHaveCount(3);
 await expect(page.getByText('(heavy crop)',{exact:true})).toHaveCount(0);
 const bounds=await page.locator('[data-photo-rotation="90"]').first().evaluate(img=>{
   const image=img.getBoundingClientRect(),cell=img.parentElement.getBoundingClientRect();
   return {width:Math.abs(image.width-cell.width),height:Math.abs(image.height-cell.height),x:Math.abs(image.x-cell.x),y:Math.abs(image.y-cell.y)};
 });
 assert.ok(Object.values(bounds).every(n=>n<=2.1),JSON.stringify(bounds));
 db.prepare('UPDATE photos SET width=8000,height=2000 WHERE id=?').run(b);
 await page.reload({waitUntil:'networkidle'});
 await expect(page.getByText('(heavy crop)',{exact:true})).toHaveCount(1);
 await expect(page.locator('[data-photo-rotation="90"]')).toHaveCount(3);
 if(artifactDir) {
   const destination=path.join(artifactDir,'rotation-aware-layout.png');
   await page.locator('[data-photo-rotation]').first().locator('xpath=ancestor::section').screenshot({path:destination});screenshots.push(destination);
 }
 db.prepare('UPDATE photos SET width=2400,height=1600 WHERE id=?').run(b);
 await page.reload({waitUntil:'networkidle'});
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM order_item_cells ORDER BY id').all()),originalCells);
 ok('Sheet previews rotate to fit without rewriting orders; matching ratios have no false crop warning and panoramic crops still warn');
 const prep=page.getByRole('region',{name:'Print preparation'}), photo=n=>prep.getByRole('article',{name:`Prepare IMG_${n}`,exact:true});
 await expect(prep.getByRole('article')).toHaveCount(2);await expect(photo(2).getByText('2 × 5x7 · 2 × 4x6')).toBeVisible();
 await expect(prep.getByRole('button',{name:'Mark printed',exact:true})).toBeDisabled();
 assert.equal((await request('/admin/api/orders/1/print-files')).status,409);
 r=await request('/admin/api/orders/1/print-files?purpose=review');assert.equal(r.status,200);const sourceZip=path.join(scratch,'source.zip');await writeFile(sourceZip,Buffer.from(await r.arrayBuffer()));
 assert.match(spawnSync('unzip',['-p',sourceZip,'*/pick-list.txt'],{encoding:'utf8'}).stdout,/NOT APPROVED FOR PRINTING/);
 assert.equal((await request('/admin/api/orders/1/print-files',{},false)).status,401);
 ok('Existing orders start in review without rewriting purchases; one review per photo; production gated but retouch source ZIP available only to owner');
 const revision=()=>prep.locator('input[name="revision"]').first().inputValue();
 async function save(button) {const before=await revision();await button.click();await expect.poll(revision).not.toBe(before);}
 await photo(9).getByLabel('Touch-up / production note').fill('PRIVATE second photo draft');
 await photo(2).getByLabel('Touch-up / production note').fill('PRIVATE remove sleeve mark');await photo(2).getByLabel('Photo status').selectOption('needs_touchup');
 await save(photo(2).getByRole('button',{name:'Save photo review'}));
 await expect(photo(9).getByLabel('Touch-up / production note')).toHaveValue('PRIVATE second photo draft');
 await expect(prep.getByRole('heading',{name:'Touch-ups',exact:true})).toBeVisible();
 await photo(2).getByRole('button',{name:'Preview IMG_2'}).click();await expect(page.getByRole('dialog',{name:'Review current edit'})).toBeVisible();
 await page.keyboard.press('ArrowRight');await expect(page.getByText('IMG_9 · Current gallery edit')).toBeVisible();await page.keyboard.press('Escape');
 await expect(photo(9).getByLabel('Touch-up / production note')).toHaveValue('PRIVATE second photo draft');
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('a[href="/admin/orders"]').first().click();await expect(page).toHaveURL(base+'/admin/orders/1');
 await save(photo(9).getByRole('button',{name:'Save photo review'}));
 ok('Touch-up queue, large previews and keyboard navigation work; saving another photo preserves unsaved notes; leaving warns');
 const requestBox=prep.getByLabel('Requests from messages or conversations');await requestBox.fill('PRIVATE parent requested matte paper by message');await save(prep.getByRole('button',{name:'Save requests',exact:true}));
 for(const n of [2,9]){await photo(n).getByLabel('Photo status').selectOption('ready');await save(photo(n).getByRole('button',{name:'Save photo review'}));}
 await expect(prep.getByRole('button',{name:'Mark printed',exact:true})).toBeDisabled();
 await save(prep.getByRole('button',{name:'Mark requests addressed',exact:true}));
 await expect(prep.getByRole('heading',{name:'Ready to print',exact:true})).toBeVisible();
 // Lose only the response, after the server has committed. Retrying must replay the same intent.
 const savedCount=()=>db.prepare("SELECT count(*) n FROM order_events WHERE type='photo_preparation'").get().n;
 const oldCount=savedCount(),oldRevision=await revision();
 await photo(2).getByLabel('Touch-up / production note').fill('PRIVATE remove sleeve mark; final reviewed');
 await page.route(url=>url.pathname==='/admin/orders/1'&&url.search==='?/work',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 await photo(2).getByRole('button',{name:'Save photo review'}).click();
 await expect.poll(savedCount).toBe(oldCount+1);await expect(page.getByText(/Could not confirm the save/)).toBeVisible();
 await expect(photo(2).getByLabel('Touch-up / production note')).toHaveValue('PRIVATE remove sleeve mark; final reviewed');
 await save(photo(2).getByRole('button',{name:'Save photo review'}));assert.equal(savedCount(),oldCount+1);
 r=await request('/admin/orders/1?/work',form({kind:'requests',notes:'Stale tab overwrites',revision:oldRevision,actionId:randomBytes(16).toString('hex')}));assert.equal(r.status,409);
 assert.ok(!db.prepare('SELECT extra_requests FROM order_fulfillment WHERE order_id=1').get().extra_requests.includes('Stale tab'));
 ok('Lost acknowledgement retains notes and retries the same save exactly once; a stale tab cannot overwrite newer requests');
 await page.waitForTimeout(4500);await shot('fulfillment-ready-desktop');
 const parentHtml=await (await request('/o/test-work-token',{},false)).text();assert.ok(!parentHtml.includes('PRIVATE'));assert.ok(parentHtml.includes('Please remove mark'));
 r=await request('/admin/api/orders/1/print-files');assert.equal(r.status,200);const readyZip=path.join(scratch,'ready.zip');await writeFile(readyZip,Buffer.from(await r.arrayBuffer()));const pick=spawnSync('unzip',['-p',readyZip,'*/pick-list.txt'],{encoding:'utf8'}).stdout;assert.match(pick,/PRODUCTION FILES/);assert.match(pick,/PRIVATE remove sleeve mark/);assert.match(pick,/matte paper/);
 ok('Private notes remain owner-only; each photo and special requests must be addressed; approved production ZIP carries instructions');
 const listPage=await ctx.newPage();await listPage.goto(base+'/admin/orders?work=ready',{waitUntil:'networkidle'});await expect(listPage.getByRole('link',{name:'TEST-WORK',exact:true})).toBeVisible();await listPage.goto(base+'/admin/orders?work=touchups',{waitUntil:'networkidle'});await expect(listPage.getByRole('link',{name:'TEST-WORK',exact:true})).toHaveCount(0);
 await listPage.goto(base+'/admin/orders/print?ids=1',{waitUntil:'networkidle'});await expect(listPage.getByText(/PRIVATE remove sleeve mark/)).toBeVisible();await expect(listPage.getByText(/PREPARATION HOLD/)).toHaveCount(0);
 ok('Order preparation filters and printed job tickets reflect reviews and private instructions');
 // Real re-upload of the same filename invalidates review but never silently changes accepted order masters.
 r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:'IMG_2.jpg',role:'print',replacement:'replace'}),{method:'PUT',body:updated,headers:{'content-type':'application/octet-stream'}});
 assert.equal(r.status,200,await r.clone().text());await waitReady(ids);await page.reload({waitUntil:'networkidle'});
 await expect(photo(2).getByText(/Master changed since review/)).toBeVisible();assert.equal(db.prepare('SELECT print_sha256 FROM order_item_cells WHERE id=1').get().print_sha256,hash);
 await expect(prep.getByRole('button',{name:'Mark printed',exact:true})).toBeDisabled();
 const approval=page.locator('form[action="?/approveMasters"]');await approval.locator('[name="reason"]').fill('Final sleeve touch-up reviewed');
 await approval.getByRole('button').click();await expect.poll(()=>db.prepare('SELECT print_sha256 FROM order_item_cells WHERE id=1').get().print_sha256).toBe(sha256(updated));
 await expect(photo(2).getByText(/Master changed since review/)).toBeVisible();await photo(2).getByLabel('Photo status').selectOption('ready');await save(photo(2).getByRole('button',{name:'Save photo review'}));
 ok('Actual corrected JPEG keeps purchased selection until explicit master approval, then requires a fresh photo review');
 await page.setViewportSize({width:390,height:844});await prep.scrollIntoViewIfNeeded();await page.waitForTimeout(4500);await shot('fulfillment-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await save(prep.getByRole('button',{name:'Mark printed',exact:true}));assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status,'printed');assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
 await save(prep.getByRole('button',{name:'Mark delivered',exact:true}));assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status,'delivered');
 await save(prep.getByRole('button',{name:'Mark printed',exact:true}));await save(prep.getByRole('button',{name:'Mark in progress',exact:true}));
 await expect(prep.getByText('0 of 2 photos reviewed · requests need attention')).toBeVisible();await expect(photo(2).getByLabel('Touch-up / production note')).toHaveValue('PRIVATE remove sleeve mark; final reviewed');
 await save(prep.getByRole('button',{name:'Cancel order',exact:true}));assert.equal((await request('/admin/api/orders/1/print-files?purpose=review')).status,409);
 ok('Mobile layout fits; printed/delivered leave payments unchanged; reopening resets reviews without losing notes; cancelled exports blocked');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(outbound,[]);console.log(JSON.stringify({passed:checks.length,checks,screenshots},null,2));
}catch(error){if(page&&artifactDir)await shot('failure',page).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
