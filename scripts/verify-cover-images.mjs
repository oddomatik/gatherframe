// Responsive cover delivery against a disposable production-build instance.
// Optional local visual fixtures are used only for screenshots, never uploaded.
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
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
  const visual=process.env.REDESIGN_VISUAL_FIXTURE;
  const source=visual ? await sharp(await readFile(path.join(visual,'collection-0.webp'))).webp().toBuffer() : await sharp({create:{width:900,height:600,channels:3,background:'#cc3344'}}).webp().toBuffer();
  for(const kind of ['thumb','preview','web'])await writeFile(path.join(dir,`${kind}.webp`),source);
  for(let n=2;n<=12;n++){
    const pid=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(group,'img'+n,`IMG_${n}.jpg`,stamp,stamp).lastInsertRowid);
    db.prepare('INSERT INTO gallery_photos VALUES(?,?)').run(group,pid);
    const pd=path.join(dataDir,`derivatives/${id}/${pid}`);await mkdir(pd,{recursive:true});
    for(const kind of ['thumb','preview','web'])await writeFile(path.join(pd,`${kind}.webp`),source);
  }
  for(let n=1;n<=5;n++){
    const gid=Number(db.prepare('INSERT INTO galleries(event_id,public_id,name,created_at) VALUES(?,?,?,?)').run(id,'kid-'+n,'Kid '+(n===5?10:n),stamp).lastInsertRowid);
    const pid=n+1;
    db.prepare('INSERT INTO gallery_photos VALUES(?,?)').run(gid,pid);
    if(visual){const bytes=await readFile(path.join(visual,`collection-${n}.webp`));for(const kind of ['thumb','preview','web'])await writeFile(path.join(dataDir,`derivatives/${id}/${pid}/${kind}.webp`),bytes);}
  }
  db.prepare('UPDATE events SET share_photo_id=? WHERE id=?').run(photo,id);
  db.prepare('UPDATE photos SET width=900,height=600').run();

  const before=Object.fromEntries(['photos','photo_files','galleries','gallery_photos','events','storage_objects'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const assets=[], sizes=[];
  for(const [width,dpr,expected] of [[390,1,'cover640'],[390,2,'cover960'],[1440,1,'cover960'],[1440,2,'cover1440']]){
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:dpr});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('response',async r=>{if(r.url().includes('/media/')&&r.status()===200)assets.push(new URL(r.url()).pathname)});
    await page.goto(base+'/g/'+slug,{waitUntil:'networkidle'});
    const image=page.locator('.album-hero-image img');await image.evaluate(img=>img.decode());
    const info=await image.evaluate(img=>({url:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight,box:img.getBoundingClientRect().toJSON()}));
    assert.ok(info.url.includes('/'+expected+'?'),info.url);
    assert.ok(!assets.some(p=>p.endsWith('/web')||p.endsWith('/preview')),JSON.stringify(assets));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await image.getAttribute('fetchpriority'),'high');
    assert.equal(await image.getAttribute('width'),'900');assert.equal(await image.getAttribute('height'),'600');
    const response=await fetch(info.url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
    const meta=await sharp(bytes).metadata();assert.ok(Math.abs(meta.width/meta.height-1.5)<.01);assert.ok(meta.width<=900);
    sizes.push({viewport:width,dpr,kind:expected,bytes:bytes.length});
    const etag=response.headers.get('etag'); // Legacy fixture deliberately remains no-store.
    assert.equal(etag,null);
    await context.close();
  }
  ok('SSR picture selects one right-sized cover on phone/retina/desktop, preserves proportions and avoids large viewing renditions');
  // A versioned fixture makes browser revalidation observable through the actual global hooks.
  const version='v2-'+'a'.repeat(64)+'-cover';
  const vd=path.join(dir,version);await mkdir(vd,{recursive:true});await writeFile(path.join(vd,'web.webp'),source);
  db.prepare('UPDATE photos SET rendition_hash=? WHERE id=?').run(version,photo);
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2}),page=await ctx.newPage();
  const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');const seen=[];
  cdp.on('Network.responseReceived',e=>{if(e.response.url.includes('/cover960'))seen.push({disk:e.response.fromDiskCache,status:e.response.status});});
  await page.goto(base+'/g/'+slug,{waitUntil:'networkidle'});const image=page.locator('.album-hero-image img');await image.evaluate(img=>img.decode());
  const url=await image.evaluate(img=>img.currentSrc),coverResponse=await fetch(url),etag=coverResponse.headers.get('etag');await coverResponse.arrayBuffer();
  assert.equal(coverResponse.headers.get('cache-control'),'private, no-cache');assert.ok(etag);
  const cached=await fetch(url,{headers:{'if-none-match':etag}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  await page.reload({waitUntil:'networkidle'});await image.evaluate(img=>img.decode());
  const artifacts=process.env.HERO_ARTIFACTS||'/tmp/picday-hero-browser';await mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'phone-cover.png')});
  const c=await fsReadCache();assert.ok(c>0);
  db.prepare('UPDATE events SET is_published=0 WHERE id=?').run(id);
  assert.equal((await fetch(url,{headers:{'if-none-match':etag}})).status,403);
  db.prepare('UPDATE events SET is_published=1,password_hash=? WHERE id=?').run('new-private-password',id);
  assert.equal((await fetch(url,{headers:{'if-none-match':etag}})).status,403);
  db.prepare('UPDATE events SET password_hash=NULL WHERE id=?').run(id);
  db.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(group);
  assert.equal((await fetch(url,{headers:{'if-none-match':etag}})).status,403);
  db.prepare('UPDATE galleries SET is_archived=0 WHERE id=?').run(group);
  db.prepare('UPDATE photos SET rendition_hash=NULL WHERE id=?').run(photo);
  ok('Global hooks preserve private conditional caching; unpublish, password change and archived membership revoke cached capabilities');
  for(const t of Object.keys(before))assert.deepEqual(db.prepare(`SELECT * FROM ${t}`).all(),before[t]);
  assert.deepEqual(errors,[]);ok('Photographs, original-file rows, memberships, settings and storage records remain unchanged');
  console.log(JSON.stringify({passed:checks.length,checks,sizes,cacheObserved:seen}));
  async function fsReadCache(){const {readdir}=await import('node:fs/promises');return (await readdir(path.join(dataDir,'cache/covers'))).length;}
} catch(error){console.error(logs);throw error;}
finally{
  await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
  if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});
}
