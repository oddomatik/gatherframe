// Disposable production-build/browser rehearsal for photo preview navigation.
// Run after npm run build: node scripts/verify-preview-navigation.mjs
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
const artifactDir = process.env.NAVIGATION_ARTIFACTS;
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

 const collection=db.prepare("INSERT INTO galleries(event_id,public_id,name,sort_order,created_at) VALUES(?, 'navigation-fixture','Kid 001',1,?)").run(eventId,new Date().toISOString()).lastInsertRowid;
 for(const id of ids) db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,id);
 db.prepare('DELETE FROM gallery_photos WHERE gallery_id=?').run(intake);
 db.prepare('UPDATE events SET is_published=1,ordering_enabled=1 WHERE id=?').run(eventId);
 db.prepare('UPDATE tags SET shared=1 WHERE id=?').run(tag.id);
 const ev=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
 const fingerprints=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','photo_tags','orders'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const unchanged=fingerprints();
 const card=id=>adminPage.locator(`[data-photo-select="${id}"]`);
 const selected=()=>adminPage.locator('main [data-photo-check][aria-pressed="true"]').evaluateAll(xs=>xs.map(x=>Number(x.dataset.photoCheck)));
 const imgId=modal=>modal.locator('.review-current img').first().evaluate(img=>Number(new URL(img.src).pathname.split('/')[2]));
 const assertPhoto=async(modal,id,counter)=>{await expect.poll(()=>imgId(modal)).toBe(id);await expect(modal.getByRole('status')).toHaveText(counter);};
 const centered=async(modal,target)=>{await expect.poll(async()=>{const b=await modal.boundingBox(),v=target.viewportSize();return !!b&&Math.abs(b.x+b.width/2-v.width/2)<3&&Math.abs(b.y+b.height/2-v.height/2)<3;}).toBe(true);};
 await adminPage.reload({waitUntil:'networkidle'});
 await adminPage.locator(`[data-photo-check="${ids[1]}"]`).click();await adminPage.getByRole('button',{name:'Done selecting',exact:true}).click();
 await card(ids[0]).click();const owner=adminPage.getByRole('dialog',{name:'Photo preview',exact:true});await assertPhoto(owner,ids[0],'1 of 5');
 await owner.getByRole('button',{name:'Next photo',exact:true}).click();await assertPhoto(owner,ids[1],'2 of 5');
 await adminPage.keyboard.press('ArrowRight');await assertPhoto(owner,ids[2],'3 of 5');
 await adminPage.keyboard.press('ArrowLeft');await assertPhoto(owner,ids[1],'2 of 5');
 assert.deepEqual(await selected(),[ids[1]]);
 await owner.getByRole('button',{name:'Previous photo',exact:true}).click();await adminPage.keyboard.press('ArrowLeft');await assertPhoto(owner,ids[4],'5 of 5');
 await adminPage.keyboard.press('ArrowRight');await assertPhoto(owner,ids[0],'1 of 5');await centered(owner,adminPage);await shot('owner-navigation',adminPage);
 const field=await owner.evaluateHandle(d=>{const input=document.createElement('input');input.value='typing';input.setAttribute('aria-label','Fixture editable field');d.append(input);input.focus();return input;});
 await adminPage.keyboard.press('ArrowRight');await assertPhoto(owner,ids[0],'1 of 5');await field.evaluate(n=>n.remove());await owner.getByRole('button',{name:'Next photo',exact:true}).focus();
 await adminPage.keyboard.press('Control+ArrowRight');await assertPhoto(owner,ids[0],'1 of 5');await adminPage.keyboard.press('Escape');await expect(owner).not.toBeVisible();await expect(card(ids[0])).toBeFocused();
 await adminPage.keyboard.press('ArrowRight');await expect(owner).not.toBeVisible();assert.deepEqual(await selected(),[ids[1]]);
 ok('Owner arrows and keys navigate, wrap, retain selection/focus, and ignore editable fields/modifiers/outside-modal keys');
 await adminPage.getByRole('combobox',{name:'Photo order',exact:true}).selectOption('desc');await adminPage.locator('#tag-panel > summary').click();
 await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).check();
 await card(ids[4]).click();await assertPhoto(owner,ids[4],'1 of 3');await adminPage.keyboard.press('ArrowRight');await assertPhoto(owner,ids[2],'2 of 3');await adminPage.keyboard.press('ArrowRight');await assertPhoto(owner,ids[0],'3 of 3');
 await adminPage.mouse.click(3,3);await expect(owner).not.toBeVisible();await expect(adminPage.getByRole('button',{name:'Keep only visible selection',exact:true})).toBeVisible();
 await adminPage.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Subset/}).uncheck();await adminPage.getByRole('combobox',{name:'Photo order',exact:true}).selectOption('asc');assert.deepEqual(await selected(),[ids[1]]);ok('Owner preview follows filtered descending shot order and preserves hidden selections');
 await adminPage.getByRole('button',{name:'Select photos',exact:true}).click();await card(ids[0]).click();await card(ids[4]).click({modifiers:['Shift']});
 await adminPage.getByRole('button',{name:'Organize 5 photos',exact:true}).click();const batch=adminPage.getByRole('dialog',{name:'Who’s in these photos?'});
 await batch.getByPlaceholder('Name optional — e.g. Kid 001').fill('Unsaved navigation draft');await batch.getByRole('button',{name:'+ Create & assign selected',exact:true}).click();
 await batch.locator(`[data-photo-select="${ids[1]}"]`).click();const nested=adminPage.getByRole('dialog',{name:'Closer look at batch photo',exact:true});await assertPhoto(nested,ids[1],'2 of 5');await adminPage.keyboard.press('ArrowRight');await assertPhoto(nested,ids[2],'3 of 5');await nested.getByRole('button',{name:'Previous photo',exact:true}).click();await assertPhoto(nested,ids[1],'2 of 5');await centered(nested,adminPage);await shot('batch-navigation',adminPage);
 await adminPage.keyboard.press('Escape');await expect(nested).not.toBeVisible();await expect(batch).toBeVisible();await expect(batch.getByRole('checkbox',{name:'Assign Unsaved navigation draft'})).toBeChecked();await expect(batch.locator('[data-photo-check][aria-pressed="true"]')).toHaveCount(5);
 adminPage.once('dialog',d=>d.accept());await batch.getByRole('button',{name:'Close sorting window',exact:true}).click();ok('Nested sorting preview navigates only its batch and preserves unsaved assignments and selected subset');
 adminPage.on('dialog',d=>d.accept());
 await adminPage.goto(base+eventPath+'/upload',{waitUntil:'networkidle'});
 await adminPage.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles([30,2,10].map(n=>({name:`QUEUE_${n}.jpg`,mimeType:'image/jpeg',buffer:full})));
 await expect(adminPage.locator('tbody tr')).toHaveCount(3);
 await adminPage.getByRole('button',{name:'Preview import photo QUEUE_2',exact:true}).click();const imp=adminPage.getByRole('dialog',{name:'Import photo preview',exact:true});await expect(imp.getByRole('heading')).toHaveText('QUEUE_2');await expect(imp.getByRole('status')).toHaveText('1 of 3');
 await adminPage.keyboard.press('ArrowRight');await expect(imp.getByRole('heading')).toHaveText('QUEUE_10');await expect(imp.getByRole('status')).toHaveText('2 of 3');await imp.getByRole('button',{name:'Next photo',exact:true}).click();await expect(imp.getByRole('heading')).toHaveText('QUEUE_30');
 await adminPage.keyboard.press('ArrowRight');await expect(imp.getByRole('heading')).toHaveText('QUEUE_2');await centered(imp,adminPage);await shot('import-navigation',adminPage);
 await imp.locator('.review-current img').click();await expect(imp).toBeVisible();await adminPage.mouse.click(3,3);await expect(imp).not.toBeVisible();await expect(adminPage.getByRole('button',{name:'Preview import photo QUEUE_2',exact:true})).toBeFocused();
 await expect(adminPage.getByRole('button',{name:'Upload files',exact:true})).toBeEnabled();await expect(adminPage.getByText('0 transferred',{exact:true})).toBeVisible();
 await adminPage.getByRole('button',{name:'Clear selection',exact:true}).click();
 await adminPage.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles([{name:'ONLY_1.xmp',mimeType:'application/xml',buffer:xmp}]);await adminPage.getByRole('button',{name:'Inspect import photo ONLY_1',exact:true}).click();await expect(imp.getByText('No JPEG preview in this row.',{exact:true})).toBeVisible();await expect(imp.getByRole('status')).toHaveText('1 of 1');await expect(imp.getByRole('button',{name:'Next photo',exact:true})).toHaveCount(0);await adminPage.keyboard.press('ArrowRight');await expect(imp.getByRole('status')).toHaveText('1 of 1');await adminPage.keyboard.press('Escape');await adminPage.getByRole('button',{name:'Clear selection',exact:true}).click();
 ok('Import thumbnail/title opens centered local preview, follows shot order, preserves queue, and handles singleton sidecar-only rows');
 const parentCtx=await browser.newContext({viewport:{width:1200,height:900}});page=await parentCtx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 const publicBase='/g/'+ev.slug;await page.goto(base+publicBase+'/browse',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Favorite photo 1',exact:true}).click();await page.getByRole('button',{name:'Favorite photo 3',exact:true}).click();
 await page.locator('article.photo-card').first().getByRole('checkbox').check();await page.getByRole('button',{name:/♥ Favorites/}).click();await page.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();const parent=page.getByRole('dialog',{name:'Photo preview',exact:true});await assertPhoto(parent,ids[0],'1 of 2');await page.keyboard.press('ArrowRight');await assertPhoto(parent,ids[2],'2 of 2');await page.keyboard.press('ArrowLeft');await assertPhoto(parent,ids[0],'1 of 2');await centered(parent,page);
 await parent.getByRole('button',{name:'♥ Saved',exact:true}).click();await assertPhoto(parent,ids[2],'1 of 1');await expect(parent.getByRole('button',{name:'Next photo',exact:true})).toHaveCount(0);await parent.getByRole('button',{name:'♥ Saved',exact:true}).click();await expect(parent).not.toBeVisible();await expect(page.getByRole('button',{name:'Download selected',exact:true})).toBeVisible();
 ok('Parent preview follows Favorites; removing current advances within favorites, last removal closes, and download selection survives');
 await page.goto(base+publicBase+'/browse?tags='+tag.publicId,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();await assertPhoto(parent,ids[0],'1 of 3');await parent.getByRole('button',{name:'Next photo',exact:true}).click();await assertPhoto(parent,ids[2],'2 of 3');await page.keyboard.press('ArrowRight');await assertPhoto(parent,ids[4],'3 of 3');await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Take a closer look at photo 2',exact:true}).click();await centered(parent,page);await parent.getByRole('button',{name:'Next photo',exact:true}).click();await assertPhoto(parent,ids[4],'3 of 3');await shot('parent-mobile-navigation');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.mouse.click(3,3);await expect(parent).not.toBeVisible();ok('Parent navigation respects tag filters and has centered narrow-screen controls and outside dismissal');
 await page.setViewportSize({width:1200,height:900});await page.goto(base+publicBase+'/c/navigation-fixture/order',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Add',exact:true}).last().click();await page.getByRole('button',{name:'Inspect photo 1',exact:true}).click();const print=page.getByRole('dialog',{name:'Photo preview',exact:true});await assertPhoto(print,ids[0],'1 of 5');
 const storedCart=()=>page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('cart')))));
 const cartBefore=await storedCart();
 await page.keyboard.press('ArrowRight');await assertPhoto(print,ids[1],'2 of 5');await print.getByRole('button',{name:'Next photo',exact:true}).click();await assertPhoto(print,ids[2],'3 of 5');assert.equal(await storedCart(),cartBefore);
 await print.getByRole('button',{name:'Use this photo',exact:true}).click();await expect(print).not.toBeVisible();
 await expect.poll(()=>page.evaluate(({eventId,id})=>{const c=JSON.parse(localStorage.getItem('pk_cart_'+eventId)||'null');const cells=c?.items.flatMap(item=>item.sheets.flatMap(sheet=>sheet.cells))??[];return cells.length>0&&cells.every(cell=>cell.photoId===id);},{eventId,id:ids[2]})).toBe(true);ok('Print chooser browses without changing the cart until Use this photo assigns the currently viewed image');
 assert.equal(fingerprints(),unchanged);assert.deepEqual(pageErrors,[]);ok('All preview interactions preserve saved files, memberships, tags and orders with no browser errors');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots},null,2));
}catch(error){if(adminPage&&artifactDir)await shot('failure-owner',adminPage).catch(()=>{});if(page&&artifactDir)await shot('failure-parent',page).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
