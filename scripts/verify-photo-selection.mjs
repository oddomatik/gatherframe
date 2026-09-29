// Disposable production-build/browser rehearsal for modifier selection.
// Run after npm run build: node scripts/verify-photo-selection.mjs
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
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-selection-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.SELECTION_ARTIFACTS;
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
 const jsonBody=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const tagUrl=`/admin/api/events/${eventId}/tags`;r=await request(tagUrl,jsonBody({action:'save',name:'Subset',shared:false}));const tag=(await r.json()).tag;
 r=await request(tagUrl,jsonBody({action:'add',photoIds:[ids[0],ids[2],ids[4]],tagIds:[tag.id]}));assert.equal(r.status,200);
 const before=JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','photo_tags'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const ctx=await browser.newContext({viewport:{width:1280,height:1000}});const eq=cookie.indexOf('=');const cookies=[{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:base,httpOnly:true,sameSite:'Lax'}];await ctx.addCookies(cookies);adminPage=await ctx.newPage();adminPage.on('pageerror',e=>pageErrors.push(e.message));await adminPage.goto(base+eventPath,{waitUntil:'networkidle'});
 const root=adminPage.locator('main').last(); // Selectors below are scoped away from dialogs when open.
 const grid=adminPage.locator('main [data-photo-select]');
 const card=(id,scope=adminPage)=>scope.locator(`[data-photo-select="${id}"]`);
 const selected=(scope=adminPage)=>scope.locator('[data-photo-check][aria-pressed="true"]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.photoCheck)));
 const assertSelected=async(expected,scope=adminPage)=>expect.poll(()=>selected(scope)).toEqual(expected);
 const corner=(id,scope=adminPage)=>scope.locator(`[data-photo-check="${id}"]`);
 const centered=async(modal,target=adminPage)=>{await expect.poll(async()=>{const b=await modal.boundingBox(),v=target.viewportSize();return !!b&&Math.abs(b.x+b.width/2-v.width/2)<3&&Math.abs(b.y+b.height/2-v.height/2)<3;}).toBe(true);};
 await card(ids[0]).click();const preview=adminPage.getByRole('dialog',{name:'Photo preview',exact:true});await expect(preview).toBeVisible();await expect.poll(()=>preview.locator('.review-current img').evaluate(i=>i.complete&&i.naturalWidth===1600)).toBe(true);await centered(preview);await shot('centered-photo-preview',adminPage);await assertSelected([]);await preview.locator('.review-current img').click();await expect(preview).toBeVisible();
 const b=await preview.boundingBox();await adminPage.mouse.move(b.x+b.width/2,b.y+30);await adminPage.mouse.down();await adminPage.mouse.move(5,5);await adminPage.mouse.up();await expect(preview).toBeVisible();
 await adminPage.mouse.click(5,5);await expect(preview).not.toBeVisible();await expect(card(ids[0])).toBeFocused();ok('Photo click opens a centered preview on a scrolled page; inside/drag clicks stay open, outside click closes and restores focus');
 await corner(ids[0]).click();await assertSelected([ids[0]]);await expect(preview).not.toBeVisible();await expect(adminPage.getByRole('button',{name:'Done selecting',exact:true})).toBeVisible();
 await corner(ids[1]).click();await assertSelected(ids.slice(0,2));await corner(ids[1]).click();await assertSelected([ids[0]]);
 await adminPage.getByRole('button',{name:'Done selecting',exact:true}).click();await card(ids[1]).click();await expect(preview).toBeVisible();await assertSelected([ids[0]]);await adminPage.keyboard.press('Escape');await expect(preview).not.toBeVisible();
 await adminPage.getByRole('button',{name:'Select photos',exact:true}).click();await expect(adminPage.getByRole('button',{name:'Done selecting',exact:true})).toBeVisible();ok('Corner checks enter selection mode and toggle independently; manual browse/select switches preserve selection; Escape closes preview');
 await card(ids[0]).click();await assertSelected([ids[0]]);
 await card(ids[4]).click({modifiers:['Shift']});await assertSelected(ids);
 await card(ids[2]).click({modifiers:['Shift']});await assertSelected(ids);ok('Shift-click retains earlier range selections');
 await card(ids[0]).click();await card(ids[1]).click({modifiers:['Control']});await card(ids[4]).click({modifiers:['Shift']});await assertSelected(ids);ok('Main grid: selecting first and second then Shift-clicking last keeps the first selected');
 await card(ids[0]).click();await card(ids[2]).click({modifiers:['Shift']});await assertSelected(ids.slice(0,3));
 await card(ids[4]).click({modifiers:['Control']});await assertSelected([ids[0],ids[1],ids[2],ids[4]]);
 await card(ids[1]).click({modifiers:['Meta']});await assertSelected([ids[0],ids[2],ids[4]]);
 await card(ids[3]).click();await assertSelected([ids[3]]);ok('Real Ctrl and Cmd clicks toggle independent photos; ordinary desktop click selects only one');
 await card(ids[0]).click({modifiers:['Control']});await card(ids[2]).click({modifiers:['Control','Shift']});await assertSelected(ids.slice(0,4));
 await card(ids[4]).click({modifiers:['Meta','Shift']});await assertSelected(ids);ok('Ctrl/Cmd+Shift add visible ranges to the existing selection');
 await adminPage.getByRole('combobox',{name:'Photo order',exact:true}).selectOption('desc');await card(ids[4]).click();await card(ids[2]).click({modifiers:['Shift']});await assertSelected([ids[4],ids[3],ids[2]]);ok('Range selection follows descending shot order rather than database IDs');
 await adminPage.locator('#tag-panel > summary').click();
 await adminPage.getByRole('combobox',{name:'Photo order',exact:true}).selectOption('asc');await card(ids[0]).click();await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).check();await card(ids[4]).click({modifiers:['Shift']});await assertSelected([ids[0],ids[2],ids[4]]);ok('Filtered-out photos are not pulled into ranges');
 await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).uncheck();await card(ids[1]).click();await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).check();await card(ids[4]).click({modifiers:['Shift']});await assertSelected([ids[4]]);await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).uncheck();await assertSelected([ids[1],ids[4]]);ok('A hidden anchor starts a fresh range while retaining the hidden selection');
 await adminPage.getByRole('button',{name:'Clear selection',exact:true}).click();await card(ids[2]).click({modifiers:['Shift']});await assertSelected([ids[2]]);ok('Clear selection resets the range anchor');
 await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).uncheck();await card(ids[0]).click();await card(ids[4]).click({modifiers:['Shift']});await adminPage.getByRole('button',{name:'Organize 5 photos',exact:true}).click();const dialog=adminPage.getByRole('dialog',{name:'Organize photos'});await expect(dialog).toBeVisible();await assertSelected(ids,dialog);
 await dialog.getByPlaceholder('Name optional — e.g. Collection 001').fill('Keep this draft');await dialog.getByRole('button',{name:'+ Create & assign selected',exact:true}).click();
 await card(ids[0],dialog).click();const batchPreview=adminPage.getByRole('dialog',{name:'Closer look at batch photo',exact:true});await expect(batchPreview).toBeVisible();await expect.poll(()=>batchPreview.locator('.review-current img').evaluate(i=>i.complete&&i.naturalWidth===1600)).toBe(true);await centered(batchPreview);await shot('centered-nested-preview',adminPage);
 await batchPreview.locator('.review-current img').click();await expect(batchPreview).toBeVisible();await adminPage.mouse.click(5,5);await expect(batchPreview).not.toBeVisible();await expect(dialog).toBeVisible();await assertSelected(ids,dialog);await expect(dialog.getByRole('checkbox',{name:'Assign Keep this draft'})).toBeChecked();
 await corner(ids[0],dialog).click();await assertSelected(ids.slice(1),dialog);await expect(dialog.getByRole('button',{name:'Done selecting',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Done selecting',exact:true}).click();await dialog.getByRole('button',{name:'Select photos',exact:true}).click();ok('Focused previews center above the batch; outside dismissal keeps the batch, draft assignments and selection intact; its corner/manual selection modes work');
 await card(ids[0],dialog).click();await card(ids[1],dialog).click({modifiers:['Meta']});await card(ids[4],dialog).click({modifiers:['Shift']});await assertSelected(ids,dialog);ok('Focused sorting: selecting first and second then Shift-clicking last keeps the first selected');
 await card(ids[1],dialog).click();await assertSelected([ids[1]],dialog);await card(ids[3],dialog).click({modifiers:['Shift']});await assertSelected(ids.slice(1,4),dialog);await card(ids[2],dialog).click({modifiers:['Control']});await assertSelected([ids[1],ids[3]],dialog);await card(ids[0],dialog).click({modifiers:['Meta']});await assertSelected([ids[0],ids[1],ids[3]],dialog);await card(ids[2],dialog).click({modifiers:['Meta','Shift']});await assertSelected(ids.slice(0,4),dialog);
 await dialog.getByRole('button',{name:'Select none in batch',exact:true}).click();await card(ids[4],dialog).click({modifiers:['Shift']});await assertSelected([ids[4]],dialog);await shot('focused-range-selection',adminPage);ok('Focused sorting window supports the same modifiers and independent anchor reset');
 adminPage.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Close sorting window',exact:true}).click();await assertSelected(ids);ok('Canceling the focused window preserves the outer selection');
 await adminPage.getByRole('button',{name:'Clear selection',exact:true}).click();await card(ids[0]).focus();await adminPage.keyboard.press('Space');await assertSelected([ids[0]]);await adminPage.keyboard.press('Space');await assertSelected([]);ok('Keyboard activation retains accessible toggle behavior');
 const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await mobile.addCookies(cookies);page=await mobile.newPage();page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(base+eventPath,{waitUntil:'networkidle'});await card(ids[0],page).tap();const mobilePreview=page.getByRole('dialog',{name:'Photo preview',exact:true});await expect(mobilePreview).toBeVisible();await centered(mobilePreview,page);await shot('centered-mobile-preview',page);await page.touchscreen.tap(3,3);await expect(mobilePreview).not.toBeVisible();await corner(ids[0],page).tap();await card(ids[1],page).tap();await assertSelected(ids.slice(0,2),page);await card(ids[0],page).tap();await assertSelected([ids[1]],page);await card(ids[1],page).scrollIntoViewIfNeeded();await shot('touch-toggle-selection');ok('Mobile photo taps preview and outside taps close; corner check starts selection and subsequent photo taps toggle');
 // A fresh, un-intercepted browser context: request routing would disable its cache.
 const cacheContext=await browser.newContext({viewport:{width:1280,height:1100}});await cacheContext.addCookies(cookies);
 const cachePage=await cacheContext.newPage();cachePage.on('pageerror',e=>pageErrors.push(e.message));
 const cdp=await cacheContext.newCDPSession(cachePage);await cdp.send('Network.enable');
 const transfers=new Map();
 cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/media/'))transfers.set(e.requestId,{url:e.request.url,cached:false,bytes:0});});
 cdp.on('Network.requestServedFromCache',e=>{const row=transfers.get(e.requestId);if(row)row.cached=true;});
 cdp.on('Network.responseReceived',e=>{const row=transfers.get(e.requestId);if(row){row.cached ||= !!e.response.fromDiskCache;row.status=e.response.status;}});
 cdp.on('Network.loadingFinished',e=>{const row=transfers.get(e.requestId);if(row)row.bytes=e.encodedDataLength;});
 const loadGrid=async()=>{await cachePage.goto(base+eventPath,{waitUntil:'networkidle'});for(const id of ids){const img=card(id,cachePage).locator('img');await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}await cachePage.waitForLoadState('networkidle');};
 await loadGrid();const firstBytes=[...transfers.values()].reduce((n,r)=>n+r.bytes,0);assert.ok(firstBytes>0);
 const imageUrl=await card(ids[0],cachePage).locator('img').getAttribute('src');
 const photo=db.prepare('SELECT rendition_hash FROM photos WHERE id=?').get(ids[0]);
 const firstResponse=await request(imageUrl);assert.equal(firstResponse.status,200);assert.equal(firstResponse.headers.get('cache-control'),'private, max-age=3600, immutable');assert.equal(firstResponse.headers.get('vary'),'Cookie');
 const imageBytes=Buffer.from(await firstResponse.arrayBuffer());const meta=await sharp(imageBytes).metadata();assert.equal(Math.max(meta.width,meta.height),400);
 transfers.clear();await cachePage.goto(base+'/admin',{waitUntil:'networkidle'});await loadGrid();
 const reused=[...transfers.values()];const repeatBytes=reused.reduce((n,r)=>n+r.bytes,0);assert.equal(repeatBytes,0,JSON.stringify(reused));
 ok(`Real browser revisits reuse thumbnail bytes (${firstBytes} bytes first visit, ${repeatBytes} on repeat)`);
 await cachePage.getByRole('button',{name:'Select photos',exact:true}).click();await card(ids[0],cachePage).click();await card(ids[4],cachePage).click({modifiers:['Shift']});transfers.clear();await cachePage.getByRole('button',{name:'Organize 5 photos',exact:true}).click();
 const sorting=cachePage.getByRole('dialog',{name:'Organize photos'});await expect(sorting).toBeVisible();
 const tileUrls=await sorting.locator('[data-photo-select] img').evaluateAll(images=>images.map(i=>i.src));assert.equal(tileUrls.length,5);assert.ok(tileUrls.every(u=>u.includes('/thumb?')));assert.ok(![...transfers.values()].some(t=>t.url.includes('/preview')));
 const selectionBefore=await selected(sorting);await sorting.locator('[data-photo-select]').first().click();
 const closer=cachePage.getByRole('dialog',{name:'Closer look at batch photo',exact:true});await expect(closer).toBeVisible();await expect.poll(()=>closer.locator('.review-current img').evaluate(i=>i.complete&&i.naturalWidth===1600)).toBe(true);
 await closer.getByRole('button',{name:'Back to sorting',exact:true}).click();await assertSelected(selectionBefore,sorting);await sorting.getByRole('button',{name:'Close sorting window',exact:true}).click();
 ok('Sorting reuses 400px thumbnails and loads a 1600px closer look only on demand, preserving selection');
 const tagHeader=firstResponse.headers.get('etag');const conditional=await request(imageUrl,{headers:{'if-none-match':tagHeader}});assert.equal(conditional.status,304);assert.equal(await conditional.text(),'');
 await cacheContext.clearCookies();const loggedOut=await cachePage.evaluate(async url=>{const r=await fetch(url);return {status:r.status,cache:r.headers.get('cache-control')};},imageUrl);assert.equal(loggedOut.status,403);assert.match(loggedOut.cache,/no-store/);
 const denied=await request(imageUrl,{headers:{'if-none-match':tagHeader}},false);assert.equal(denied.status,403);assert.match(denied.headers.get('cache-control'),/no-store/);
 ok('Cookie-separated browser cache cannot reuse owner images after logout; unauthorized conditional requests fail closed');
 await cacheContext.close();
 assert.equal(JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','photo_tags'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))),before);assert.deepEqual(pageErrors,[]);ok('Selection changes do not alter photo files, memberships or tags and raise no browser errors');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots},null,2));
}catch(error){if(adminPage&&artifactDir)await shot('failure',adminPage).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
