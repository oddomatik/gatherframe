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
const artifactDir = process.env.UX_ARTIFACTS;
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
 let r=await request('/setup',form({email:'selection@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Fieldwork Studio'}));assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
 r=await request('/admin?/create',form({name:'Autumn portraits'}));const eventPath=r.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));await request(eventPath+'/upload');db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');
 const intake=db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
 const ids=[];for(const n of [2,9,10,21,30]){r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`IMG_${n}.jpg`,role:'print'}),{method:'PUT',body:full,headers:{'content-type':'application/octet-stream'}});assert.equal(r.status,200);ids.push((await r.json()).photoId);}await waitReady(ids);

 const gid=db.prepare("INSERT INTO galleries(event_id,public_id,name,sort_order,created_at) VALUES(?, 'portrait-fixture','Kid 001',1,?)").run(eventId,new Date().toISOString()).lastInsertRowid;
 for(const id of ids) db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(gid,id);
 db.prepare('DELETE FROM gallery_photos WHERE gallery_id=?').run(intake);
 db.prepare('UPDATE events SET is_published=1 WHERE id=?').run(eventId);
 const ev=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||chromium.executablePath()});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 const eq=cookie.indexOf('=');await ctx.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:base}]);
 page=await ctx.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 const metrics={};
 for(const [name,url] of [['organizer',eventPath],['upload',eventPath+'/upload'],['parent','/g/'+ev.slug],['collection','/g/'+ev.slug+'/c/portrait-fixture']]){
  await page.goto(base+url,{waitUntil:'networkidle'});await shot(name);
  metrics[name]=await page.evaluate(()=>({words:document.body.innerText.split(/\s+/).length,firstPhotoY:document.querySelector('[data-photo-select]')?.getBoundingClientRect().y??null,overflow:document.documentElement.scrollWidth>innerWidth}));
 }
 await page.goto(base+eventPath,{waitUntil:'networkidle'});
 await page.locator('[data-photo-check]').first().click();await page.getByRole('button',{name:'Organize 1 photo',exact:true}).click();await shot('sorting');await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.goto(base+eventPath,{waitUntil:'networkidle'});await shot('organizer-mobile');
 metrics.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 assert.equal(metrics.mobileOverflow,false);
 await page.getByRole('button',{name:'Collections · All photos',exact:true}).click();await expect(page.getByRole('navigation',{name:'Photo collections'})).toBeVisible();
 await page.setViewportSize({width:1440,height:1000});
 const fingerprints=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','photo_tags'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const preserved=fingerprints();
 const second=await request('/admin?/create',form({name:'Another project'}));const otherId=Number(second.headers.get('location').split('/').at(-1));
 const tagline='Autumn portraits <b>2026</b>';
 await page.getByRole('tab',{name:'Settings',exact:true}).click();const settings=page.locator('#project-settings');
 await settings.locator('input[name=tagline]').fill(tagline);await settings.getByRole('button',{name:'Save project settings',exact:true}).click();
 await expect.poll(()=>db.prepare('SELECT tagline FROM events WHERE id=?').get(eventId).tagline).toBe(tagline);
 await page.reload({waitUntil:'networkidle'});await expect(page.locator('#project-settings input[name=tagline]')).toHaveValue(tagline);
 const parent=await browser.newPage();await parent.goto(base+'/g/'+ev.slug,{waitUntil:'networkidle'});await expect(parent.locator('header').getByText(tagline,{exact:true})).toBeVisible();assert.equal(await parent.locator('header b').count(),0);
 assert.equal(db.prepare('SELECT tagline FROM events WHERE id=?').get(otherId).tagline,null);
 const savedEvent=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
 // Stale tabs omitting the new field must retain it.
 const settingsForm={name:savedEvent.name,isPublished:'on',orderingEnabled:'on',p_print:'free',p_social:'free',p_raw:'free'};
 assert.equal((await request(eventPath+'?/update',form(settingsForm))).status,200);
 assert.equal(db.prepare('SELECT tagline FROM events WHERE id=?').get(eventId).tagline,tagline);
 const anonymous=await request(eventPath+'?/update',form({...settingsForm,tagline:'Unauthorized'}),false);assert.ok([303,401,403].includes(anonymous.status));assert.equal(db.prepare('SELECT tagline FROM events WHERE id=?').get(eventId).tagline,tagline);
 await page.getByRole('tab',{name:'Settings',exact:true}).click();await settings.locator('input[name=tagline]').fill('');await settings.getByRole('button',{name:'Save project settings',exact:true}).click();await expect.poll(()=>db.prepare('SELECT tagline FROM events WHERE id=?').get(eventId).tagline).toBe(null);
 await parent.reload({waitUntil:'networkidle'});await expect(parent.getByText(tagline,{exact:true})).toHaveCount(0);await parent.close();
 assert.equal(fingerprints(),preserved);ok('Project tagline persists, is escaped and project-scoped, clears cleanly, survives stale forms, requires owner access, and leaves photos/memberships intact');

 assert.equal(pageErrors.length,0,JSON.stringify(pageErrors));
 if(artifactDir)await writeFile(path.join(artifactDir,'metrics.json'),JSON.stringify(metrics,null,2));
 console.log(JSON.stringify(metrics,null,2));
}finally{if(browser)await browser.close();if(db)db.close();child.kill('SIGTERM');await once(child,'exit');await rm(scratch,{recursive:true,force:true});}
