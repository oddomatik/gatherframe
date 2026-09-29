// Isolated mobile-gallery rehearsal using Chromium touch input (not a physical phone).
// Run after npm run build: node scripts/verify-mobile-gallery.mjs
// Never contacts SSH, live hosts, external services, or production data.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'gatherframe-mobile-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.MOBILE_ARTIFACTS;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, page, cookie = '';
child.stdout.on('data', b => { logs = (logs + b).slice(-16000); });
child.stderr.on('data', b => { logs = (logs + b).slice(-16000); });
const checks = [], pageErrors = [], screenshots = [];
const ok = name => { checks.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const full = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#6699aa' } }).jpeg().toBuffer();
const portrait = await sharp({ create: { width: 1600, height: 2400, channels: 3, background: '#cc9955' } }).jpeg().toBuffer();
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
try {
 for(let i=0;i<100;i++){try{if((await request('/healthz')).ok)break;}catch{}if(i===99||child.exitCode!==null)throw Error(logs);await delay(100);}
 let r=await request('/setup',form({email:'selection@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Gatherframe Studio'}));assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
 r=await request('/admin?/create',form({name:'Autumn picture day'}));const eventPath=r.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));await request(eventPath+'/upload');db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');
 const intake=db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
 const ids=[];for(const n of Array.from({length:8},(_,i)=>i+1)){r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`IMG_${n}.jpg`,role:'print'}),{method:'PUT',body:n===2?portrait:full,headers:{'content-type':'application/octet-stream'}});assert.equal(r.status,200);ids.push((await r.json()).photoId);}await waitReady(ids);
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



 const fingerprint=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','orders','payments'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const before=fingerprint();
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const outbound=[];await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(outbound.push(route.request().url()),route.abort()));
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 const cdp=await ctx.newCDPSession(page);
 const album=`${base}/g/${ev.slug}`,galleryUrl=album+'/c/payment-fixture';
 const viewer=()=>page.locator('.gatherframe-viewer');
 const open=async(n=1)=>{await page.getByRole('button',{name:`Take a closer look at photo ${n}`,exact:true}).click();await expect(viewer()).toHaveClass(/pswp--ui-visible/);await expect(viewer().locator('.pswp__item').last()).toBeVisible();};
 const current=async(id,counter)=>{await expect(viewer()).toHaveAttribute('data-photo-id',String(id));await expect(viewer().getByRole('status')).toHaveText(counter);};
 const close=async()=>{await viewer().getByRole('button',{name:'Close photo preview',exact:true}).click();await expect(viewer()).toHaveCount(0);};
 async function gesture(points){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points[0]});
   for(const touchPoints of points.slice(1)){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints});await delay(20);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(350);
 }
 const swipe=async(direction)=>gesture(Array.from({length:10},(_,i)=>[{x:direction==='left'?330-i*30:60+i*30,y:400,id:1}]));
 const zoom=async(id)=>viewer().locator(`.pswp__img:not(.pswp__img--placeholder)[src*="/${id}/"]`).evaluate(img=>img.getBoundingClientRect().width);
 await page.goto(album,{waitUntil:'networkidle'});await shot('album-mobile');
 await page.goto(galleryUrl,{waitUntil:'networkidle'});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await shot('gallery-mobile');
 const measurements=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,titleSize:getComputedStyle(document.querySelector('h1')).fontSize,firstPhotoY:document.querySelector('[data-guest-photo]').getBoundingClientRect().top}));
 assert.ok(measurements.firstPhotoY<320);assert.ok(parseFloat(measurements.titleSize)<=36);
 const first=page.locator('[data-guest-photo]').first();await first.getByRole('checkbox').check();
 await open();await current(ids[0],'1 of 8');
 const box=await viewer().boundingBox();assert.deepEqual(box,{x:0,y:0,width:390,height:844});
 await expect(viewer()).toHaveAttribute('aria-modal','true');
 await shot('viewer-mobile');
 await swipe('left');await current(ids[1],'2 of 8');await shot('portrait-mobile');
 const portraitBox=await viewer().locator(`.pswp__img:not(.pswp__img--placeholder)[src*="/${ids[1]}/"]`).boundingBox();assert.ok(Math.abs(portraitBox.width/portraitBox.height-2/3)<.02);
 await swipe('right');await current(ids[0],'1 of 8');
 ok('Phone opens an edge-to-edge accessible viewer; touch swipes navigate landscape and portrait photos without cropping');
 const initial=await zoom(ids[0]);
 await page.touchscreen.tap(195,400);await page.touchscreen.tap(195,400);
 await expect.poll(()=>zoom(ids[0])).toBeGreaterThan(initial*1.3);
 await page.touchscreen.tap(195,400);await page.touchscreen.tap(195,400);
 await expect.poll(()=>zoom(ids[0])).toBeCloseTo(initial,2);
 await gesture(Array.from({length:9},(_,i)=>[{x:170-i*10,y:400,id:1},{x:220+i*10,y:400,id:2}]));
 await expect.poll(()=>zoom(ids[0])).toBeGreaterThan(initial*1.3);await current(ids[0],'1 of 8');
 await viewer().getByRole('button',{name:'Zoom photo',exact:true}).click();await expect.poll(()=>zoom(ids[0])).toBeCloseTo(initial,2);
 await page.touchscreen.tap(195,400);await expect(viewer()).not.toHaveClass(/pswp--ui-visible/);
 await page.touchscreen.tap(195,400);await expect(viewer()).toHaveClass(/pswp--ui-visible/);
 ok('Double tap and two-finger pinch zoom the current image; one tap hides and restores controls');
 await close();await expect(first.getByRole('checkbox')).toBeChecked();await expect(page.getByRole('button',{name:'Take a closer look at photo 1',exact:true})).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe('');
 await page.getByRole('button',{name:'Take a closer look at photo 7',exact:true}).scrollIntoViewIfNeeded();
 const scrollBefore=await page.evaluate(()=>scrollY);await open(7);await page.keyboard.press('Escape');await expect(viewer()).toHaveCount(0);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<3);
 await expect(first.getByRole('checkbox')).toBeChecked();
 ok('Close and Escape restore focus, scroll position and overflow without clearing download selection');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await open();
 await viewer().getByRole('button',{name:'♡ Favorite',exact:true}).click();await expect(viewer().getByRole('button',{name:'♥ Saved',exact:true})).toHaveAttribute('aria-pressed','true');
 await swipe('left');await viewer().getByRole('button',{name:'♡ Favorite',exact:true}).click();await close();
 await page.getByRole('button',{name:/♥ Favorites/}).click();await open();await current(ids[0],'1 of 2');
 await swipe('left');await current(ids[1],'2 of 2');
 await viewer().getByRole('button',{name:'♥ Saved',exact:true}).click();await current(ids[0],'1 of 1');
 await expect(viewer().getByRole('button',{name:'Next photo',exact:true})).not.toBeVisible();
 await viewer().getByRole('button',{name:'♥ Saved',exact:true}).click();await expect(viewer()).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Download selected',exact:true})).toBeVisible();
 ok('Favorite removal rebuilds only the filtered set, advances correctly, closes on last removal and retains selection');
 await page.getByRole('button',{name:/All photos ·/}).click();await open(2);
 await viewer().getByRole('button',{name:'Download photo',exact:true}).click();await expect(viewer()).toHaveCount(0);
 const sheet=page.getByRole('dialog',{name:'Download photo',exact:true});await expect(sheet).toBeVisible();
 await expect(sheet.getByRole('button',{name:/Download files/})).toBeEnabled();await sheet.getByRole('button',{name:'Close Download photo',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe('');
 ok('Download opens the existing full-quality download sheet and does not leave a hidden viewer or scroll lock');
 await open();await gesture(Array.from({length:10},(_,i)=>[{x:195,y:300+i*35,id:1}]));await expect(viewer()).toHaveCount(0);ok('A vertical swipe dismisses the unzoomed viewer');
 // Exercise tag-restricted views, not just the complete gallery.
 r=await request(`/admin/api/events/${eventId}/tags`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save',name:'Shared subset',shared:true})});const tag=(await r.json()).tag;
 r=await request(`/admin/api/events/${eventId}/tags`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'add',photoIds:[ids[0],ids[2],ids[4]],tagIds:[tag.id]})});assert.equal(r.status,200);
 await page.goto(galleryUrl+'?tags='+tag.publicId,{waitUntil:'networkidle'});
 await expect(page.getByRole('button',{name:'Filters · 1 active',exact:true})).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Filters · 1 active',exact:true}).click();await expect(page.getByRole('combobox',{name:'Match tags'})).toBeVisible();
 await page.getByRole('button',{name:'Filters · 1 active',exact:true}).click();await open();await current(ids[0],'1 of 3');
 await swipe('left');await current(ids[2],'2 of 3');await swipe('left');await current(ids[4],'3 of 3');await swipe('left');await current(ids[0],'1 of 3');await close();
 ok('Tag filters remain usable on phones and swipe order stays inside the filtered set, including wraparound');
 for(const width of [320,390,430,768]){
   await page.setViewportSize({width,height:844});await page.goto(galleryUrl,{waitUntil:'networkidle'});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const hit=await page.getByRole('button',{name:'Favorite photo 1',exact:true}).boundingBox();assert.ok(hit.width>=44&&hit.height>=44);
   await open();const frame=await viewer().boundingBox();assert.equal(frame.width,width);assert.equal(frame.height,844);
   for(const button of await viewer().locator('.pswp__photo-actions button').all()) { const b=await button.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width&&b.height>=44,JSON.stringify({width,button:await button.innerText(),box:b})); }
   await close();
 }
 await page.setViewportSize({width:390,height:844});await open(2);
 await page.setViewportSize({width:844,height:390});await expect.poll(async()=>Math.round((await viewer().boundingBox()).height)).toBe(390);await current(ids[1],'2 of 8');await expect.poll(async()=>{const b=await viewer().locator(`.pswp__img:not(.pswp__img--placeholder)[src*="/${ids[1]}/"]`).boundingBox();return Math.abs(b.x+b.width/2-422)<2&&b.y>=0&&b.y+b.height<=390;}).toBe(true);await shot('viewer-landscape');await close();
 ok('320–768px touch layouts have no horizontal overflow, 44px targets, and retain the open photo across rotation');
 // A fresh browser context ensures this request is not satisfied by a decoded-image cache.
 const previousPage=page,errorCtx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await errorCtx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(outbound.push(route.request().url()),route.abort()));
 page=await errorCtx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));let failedRequests=0;
 const failingMedia=`**/media/${ids[0]}/web?**`;
 await page.route(failingMedia,route=>{failedRequests++;return route.fulfill({status:503,body:'Fixture unavailable'});});
 await page.goto(galleryUrl,{waitUntil:'networkidle'});await open();
 await expect(viewer().getByText(/This preview could not load/)).toBeVisible();assert.ok(failedRequests>0);await expect(viewer().getByRole('button',{name:'Retry photo',exact:true})).toBeVisible();
 await page.unroute(failingMedia);await viewer().getByRole('button',{name:'Retry photo',exact:true}).click();await expect(viewer().getByText(/This preview could not load/)).toHaveCount(0);
 await expect.poll(()=>viewer().locator('.pswp__img:not(.pswp__img--placeholder)').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await close();await errorCtx.close();page=previousPage;
 ok('A failed preview can be retried without reopening the gallery');
 await page.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();await expect(viewer()).toBeVisible();await page.keyboard.press('Escape');await expect(viewer()).toHaveCount(0);ok('Escape also dismisses the viewer during its opening transition');
 const desktop=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const dp=await desktop.newPage();dp.on('pageerror',e=>pageErrors.push(e.message));await dp.goto(galleryUrl,{waitUntil:'networkidle'});
 await dp.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();const dialog=dp.getByRole('dialog',{name:'Photo preview',exact:true});
 await expect(dialog.getByRole('navigation',{name:'Photo filmstrip'})).toBeVisible();await dialog.getByRole('button',{name:'Compare photos',exact:true}).click();await expect(dialog.locator('.reference-photo')).toBeVisible();
 await dialog.getByRole('button',{name:'End comparison',exact:true}).click();await dialog.getByRole('button',{name:'Full screen',exact:true}).click();
 const dv=dp.locator('.gatherframe-viewer');await expect(dv).toBeVisible();await dp.keyboard.press('ArrowRight');await expect(dv.getByRole('status')).toHaveText('3 of 8');await shot('viewer-desktop',dp);
 await dp.keyboard.press('Escape');await expect(dv).toHaveCount(0);assert.ok(await dp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await desktop.close();ok('Desktop keeps comparison/filmstrip and gains optional full screen with keyboard navigation and reduced-motion support');
 assert.equal(fingerprint(),before);assert.deepEqual(pageErrors,[]);assert.deepEqual(outbound,[]);
 ok('Browsing preserves photos, file versions, memberships, orders and payments with zero browser errors');
 console.log(JSON.stringify({passed:checks.length,checks,measurements,screenshots,limitation:'Chromium touch emulation; physical iOS/Android device behavior not certified.'},null,2));
}catch(error){if(page&&artifactDir)await shot('failure',page).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
