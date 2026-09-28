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
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-activity-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.ACTIVITY_ARTIFACTS;
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
 const ids=[];for(const n of Array.from({length:4},(_,i)=>i+1)){r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`IMG_${n}.jpg`,role:'print'}),{method:'PUT',body:full,headers:{'content-type':'application/octet-stream'}});assert.equal(r.status,200);ids.push((await r.json()).photoId);}await waitReady(ids);
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

 const ua='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
 const ctx=await browser.newContext({viewport:{width:390,height:844},userAgent:ua});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await ctx.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{value:()=>true});Object.defineProperty(navigator,'share',{value:async()=>{}});});
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 const album=`${base}/g/${ev.slug}`,gallery=album+'/c/payment-fixture';
 const counts=()=>Object.fromEntries(db.prepare('SELECT kind,count(*) n FROM guest_activity GROUP BY kind').all().map(r=>[r.kind,r.n]));
 await ctx.request.get(album);assert.deepEqual(counts(),{}); // HTML fetch/preloads are not views.
 await page.goto(album,{waitUntil:'networkidle'});
 await expect.poll(()=>counts().album_view).toBe(1);
 await page.getByRole('button',{name:'Add collection 1 to My family',exact:true}).click();
 await expect.poll(()=>counts().family_add).toBe(1);
 await page.getByRole('button',{name:'Remove collection 1 from My family',exact:true}).click();
 await expect.poll(()=>counts().family_remove).toBe(1);
 await page.getByRole('button',{name:'Add collection 1 to My family',exact:true}).click();
 await expect.poll(()=>counts().family_add).toBe(2);
 await page.getByRole('link',{name:/Open photo collection 1,/}).click();
 await expect.poll(()=>counts().collection_view).toBe(1);
 await page.getByRole('button',{name:'Favorite photo 1',exact:true}).click();
 await expect.poll(()=>counts().favorite_add).toBe(1);
 await page.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();
 await expect.poll(()=>counts().photo_view).toBe(1);
 await page.getByRole('button',{name:'Next photo',exact:true}).click();
 await expect.poll(()=>counts().photo_view).toBe(2);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Remove favorite photo 1',exact:true}).click();
 await expect.poll(()=>counts().favorite_remove).toBe(1);
 // Repeated render, query-only filter, and return-position storage must not count new opens.
 await page.getByRole('button',{name:'♥ Favorites · 0',exact:true}).click();
 await page.getByRole('button',{name:'All photos · 4',exact:true}).click();
 assert.equal(counts().collection_view,1);ok('actual gallery/family/favorite/preview actions count once; rerenders do not');
 const file=db.prepare("SELECT id,bytes FROM photo_files WHERE photo_id=? AND role='print'").get(ids[0]);
 const initial=counts();let r2=await ctx.request.head(`${album}/file/${file.id}`);assert.equal(r2.status(),200);assert.deepEqual(counts(),initial);
 r2=await ctx.request.get(`${album}/file/${file.id}`,{headers:{Range:'bytes=0-10'}});assert.equal(r2.status(),206);await r2.body();await expect.poll(()=>counts().download_start).toBe(1);assert.equal(counts().download_complete,undefined);
 r2=await ctx.request.get(`${album}/file/${file.id}`);assert.equal(r2.status(),200);assert.equal((await r2.body()).length,file.bytes);await expect.poll(()=>counts().download_complete).toBe(1);
 await page.getByRole('button',{name:'Download photo ↓',exact:true}).first().click();
 await page.getByRole('button',{name:'Prepare photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open share sheet',exact:true})).toBeVisible();
 await expect.poll(()=>db.prepare("SELECT count(*) n FROM guest_activity WHERE kind='download_complete' AND channel='phone'").get().n).toBe(1);
 await page.keyboard.press('Escape');
 r2=await ctx.request.post(`${album}/api/zip`,{headers:{origin:base},data:{photoIds:ids.slice(0,2),roles:['print']}});assert.equal(r2.status(),200);const zip=await r2.json();
 r2=await ctx.request.get(base+zip.url);assert.equal(r2.status(),200);assert.equal((await r2.body()).subarray(0,2).toString(),'PK');
 await expect.poll(()=>db.prepare("SELECT sum(print_files) n FROM guest_activity WHERE kind='download_complete' AND channel='zip'").get().n).toBe(2);
 ok('real full-file, phone preparation and ZIP streams measured; metadata/partial requests never count complete');
 const post=a=>ctx.request.post(album+'/api/activity',{headers:{origin:base},data:a});
 const duplicate={id:crypto.randomUUID(),kind:'album_view'};await post(duplicate);await post(duplicate);assert.equal(counts().album_view,2);
 assert.equal((await ctx.request.post(album+'/api/activity',{headers:{origin:'https://foreign.invalid'},data:{...duplicate,id:crypto.randomUUID()}})).status(),403);
 assert.equal((await post({id:crypto.randomUUID(),kind:'favorite_add',photoId:99999})).status(),404);
 const beforeOwner=counts();
 const owner=await browser.newContext({viewport:{width:1440,height:1000},userAgent:ua});
 await owner.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
 adminPage=await owner.newPage();adminPage.on('pageerror',e=>pageErrors.push(e.message));
 await adminPage.goto(gallery,{waitUntil:'networkidle'});await adminPage.getByRole('button',{name:'Favorite photo 1',exact:true}).click();
 await adminPage.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();await adminPage.keyboard.press('Escape');
 assert.deepEqual(counts(),beforeOwner);ok('replay de-duplication, private references, cross-site and photographer exclusions');
 assert.equal((await ctx.request.get(base+'/admin/visibility',{maxRedirects:0})).status(),303);
 await adminPage.goto(base+'/admin/visibility?event='+eventId,{waitUntil:'networkidle'});
 await expect(adminPage.getByRole('heading',{name:'Visibility',exact:true})).toBeVisible();
 const totals=adminPage.getByRole('region',{name:'Engagement totals'});
 for(const [label,value] of [['Gallery views','3'],['Guest browsers','1'],['My family adds','2'],['Favorite adds','1'],['Photo previews','2'],['Downloads sent','3']])await expect(totals.locator('article').filter({has:adminPage.getByRole('heading',{name:label,exact:true})}).locator('p').first()).toHaveText(value);
 await expect(adminPage.getByRole('region',{name:'Downloads by type'})).toContainText('Phone share preparation');
 await shot('visibility-desktop',adminPage);
 await adminPage.setViewportSize({width:390,height:844});await shot('visibility-phone',adminPage);
 assert.equal(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await adminPage.getByLabel('From',{exact:true}).fill('2020-01-01');await adminPage.getByLabel('Through',{exact:true}).fill('2020-01-02');await adminPage.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(adminPage.getByText('No guest activity in this period yet.',{exact:true})).toBeVisible();
 ok('authenticated dashboard exact totals, empty range, desktop and phone fit');
 // Revocation prevents new activity and bytes, even after a guest already viewed the page.
 db.prepare('UPDATE events SET password_hash=? WHERE id=?').run('changed',eventId);
 assert.equal((await post({id:crypto.randomUUID(),kind:'album_view'})).status(),401);
 assert.equal((await ctx.request.get(`${album}/file/${file.id}`)).status(),401);
 const prior=counts();await page.goto(album,{waitUntil:'networkidle'});await expect(page.getByLabel('Gallery password',{exact:true})).toBeVisible();assert.deepEqual(counts(),prior);
 ok('password revocation blocks both telemetry and downloads; locked pages do not count');
 assert.deepEqual(pageErrors,[]);assert.equal(db.pragma('quick_check',{simple:true}),'ok');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots,pageErrors}));
} catch(err){console.error(logs);throw err;} finally{await browser?.close();db?.close();child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(5000)]);await rm(scratch,{recursive:true,force:true});}
