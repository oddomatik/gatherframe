// Real enhanced-form actions against a disposable production-build instance.
// EXPECT_TOAST_LOOP=1 reproduces the old bug before rebuilding with the fix.
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-share-'));
const dataDir = path.join(scratch, 'data');
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, cookie = '';
child.stdout.on('data', b => { logs = (logs + b).slice(-10000); });
child.stderr.on('data', b => { logs = (logs + b).slice(-10000); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [], requests = [];
function ok(name) { checks.push(name); console.log(`PASS ${name}`); }
async function request(url, entries) {
  return fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { origin: base, accept: 'text/html', ...(cookie ? { cookie } : {}) },
    ...(entries ? { method: 'POST', body: new URLSearchParams(entries) } : {}) });
}
try {
  for(let i=0;i<100;i++){try{if((await request('/healthz')).ok)break;}catch{}if(i===99||child.exitCode!==null)throw Error(logs);await delay(100);}
  let r=await request('/setup',{email:'share@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Sharing fixture'});
  assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
  r=await request('/admin?/create',{name:'Group & Friends 2026'});
  const eventPath=r.headers.get('location'),id=Number(eventPath.split('/').at(-1));
  db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');
  const stamp=new Date().toISOString(),slug=db.prepare('SELECT slug FROM events WHERE id=?').get(id).slug;
  db.prepare('UPDATE events SET is_published=1 WHERE id=?').run(id);
  const group=Number(db.prepare('INSERT INTO galleries(event_id,public_id,name,created_at) VALUES(?,?,?,?)').run(id,'group-fixture','Group',stamp).lastInsertRowid);
  const photo=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(group,'group1','Group_1.jpg',stamp,stamp).lastInsertRowid);
  db.prepare('INSERT INTO gallery_photos VALUES(?,?)').run(group,photo);
  const dir=path.join(dataDir,`derivatives/${id}/${photo}`);await mkdir(dir,{recursive:true});
  const source=await sharp({create:{width:900,height:600,channels:3,background:'#cc3344'}}).webp().toBuffer();
  for(const kind of ['thumb','preview','web'])await writeFile(path.join(dir,`${kind}.webp`),source);
  const before=Object.fromEntries(['photos','photo_files','galleries','gallery_photos'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+eventPath,{waitUntil:'networkidle'});
  await page.getByRole('tab',{name:'Sharing',exact:true}).click();
  const panel=page.getByRole('region',{name:'Link preview'});
  await expect(panel.getByText('Project title card',{exact:true})).toBeVisible();
  const readMeta=async()=>{const text=await(await fetch(`${base}/g/${slug}`)).text();const doc=await browser.newContext({javaScriptEnabled:false});const p=await doc.newPage();await p.setContent(text);const result={image:await p.locator('meta[property="og:image"]').getAttribute('content'),title:await p.locator('meta[property="og:title"]').getAttribute('content'),url:await p.locator('meta[property="og:url"]').getAttribute('content')};await doc.close();return result;};
  const initial=await readMeta();assert.equal(initial.title,'Group & Friends 2026');assert.ok(initial.image.startsWith(base+'/share/'));
  let imageResponse=await fetch(initial.image);assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('content-type'),'image/jpeg');
  assert.equal((await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata()).width,1200);
  ok('Default title card and complete OG metadata are rendered for a no-JavaScript crawler');
  await panel.getByRole('button',{name:'Choose album photo',exact:true}).click();
  await panel.getByRole('searchbox',{name:'Find preview photo or collection'}).fill('Group');
  await panel.getByRole('button',{name:'Choose Group_1.jpg · Group'}).click();
  await panel.getByRole('button',{name:'Use selected photo',exact:true}).click();
  await expect(panel.getByText('Album photo',{exact:true})).toBeVisible();
  assert.equal(db.prepare('SELECT share_photo_id FROM events WHERE id=?').get(id).share_photo_id,photo);
  const chosen=await readMeta();assert.notEqual(chosen.image,initial.image);assert.equal((await fetch(initial.image)).status,404);
  await panel.getByRole('button',{name:'Copy updated share link'}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),chosen.url);
  ok('Choosing from Group saves independently, changes metadata/image URL, and copies the versioned share link');
  const custom=await sharp({create:{width:600,height:315,channels:3,background:'#228844'}}).png().toBuffer();
  await panel.locator('input[type=file]').setInputFiles({name:'custom.png',mimeType:'image/png',buffer:custom});
  await panel.getByRole('button',{name:'Use uploaded image',exact:true}).click();
  await expect(panel.getByText('Custom image',{exact:true})).toBeVisible();
  const uploaded=await readMeta();assert.notEqual(uploaded.image,chosen.image);
  const raw=await sharp(Buffer.from(await(await fetch(uploaded.image)).arrayBuffer())).raw().toBuffer({resolveWithObject:true});
  assert.ok(raw.data[1]>100&&raw.data[0]<60);assert.equal(raw.info.width,1200);assert.equal(raw.info.height,630);
  ok('Custom image upload is durable, normalized, and served to anonymous crawlers');
  db.prepare("UPDATE events SET password_hash='locked' WHERE id=?").run(id);
  assert.match(await(await fetch(`${base}/g/${slug}`)).text(),/Enter the password/);
  assert.equal((await fetch(uploaded.image)).status,200);
  assert.equal((await fetch(`${base}/admin/api/events/${id}/share-image`)).status,401);
  assert.notEqual((await fetch(`${base}/media/${photo}/thumb`)).status,200);
  ok('Password gate remains closed; only the explicitly chosen promotional image is public');
  await panel.getByRole('button',{name:'Use title card',exact:true}).click();
  await expect(panel.getByText('Project title card',{exact:true})).toBeVisible();
  const title=await readMeta();assert.equal(title.image,initial.image);
  const etag=(await fetch(title.image)).headers.get('etag');
  assert.equal((await fetch(title.image,{headers:{'if-none-match':etag}})).status,304);
  for(const patch of ["is_published=0","is_published=1,expires_at='2000-01-01'"]){
    db.prepare(`UPDATE events SET ${patch} WHERE id=?`).run(id);
    assert.equal((await fetch(title.image,{headers:{'if-none-match':etag,cookie}})).status,404);
    const response=await fetch(`${base}/g/${slug}`);assert.ok(!(await response.text()).includes('property="og:image"'));
  }
  db.prepare('UPDATE events SET is_published=1,expires_at=NULL,password_hash=NULL WHERE id=?').run(id);
  ok('Reset works; unpublished/expired images cannot return success or 304, even with owner cookies');
  await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('/tmp/picture-day-share-proof',{recursive:true});await panel.screenshot({path:'/tmp/picture-day-share-proof/mobile.png'});
  await page.setViewportSize({width:1280,height:1000});await panel.screenshot({path:'/tmp/picture-day-share-proof/desktop.png'});
  await writeFile('/tmp/picture-day-share-proof/title.jpg',Buffer.from(await(await fetch(title.image)).arrayBuffer()));
  for(const t of Object.keys(before))assert.deepEqual(db.prepare(`SELECT * FROM ${t}`).all(),before[t]);
  assert.deepEqual(errors,[]);
  ok('Mobile controls fit; all photos, files, memberships and collection covers are unchanged');
  console.log(JSON.stringify({passed:checks.length,checks,browserErrors:errors}));
} catch(error){console.error(logs);throw error;}
finally{
  await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
  if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});
}
