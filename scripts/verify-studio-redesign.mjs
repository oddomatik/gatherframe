// Photo-studio workflows against a disposable production-build instance.
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
  db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(group,photo);
  const dir=path.join(dataDir,`derivatives/${id}/${photo}`);await mkdir(dir,{recursive:true});
  const visual=process.env.REDESIGN_VISUAL_FIXTURE;
  const source=visual ? await sharp(await readFile(path.join(visual,'collection-0.webp'))).webp().toBuffer() : await sharp({create:{width:900,height:600,channels:3,background:'#cc3344'}}).webp().toBuffer();
  for(const kind of ['thumb','preview','web'])await writeFile(path.join(dir,`${kind}.webp`),source);
  for(let n=2;n<=12;n++){
    const pid=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(group,'img'+n,`IMG_${n}.jpg`,stamp,stamp).lastInsertRowid);
    db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(group,pid);
    const pd=path.join(dataDir,`derivatives/${id}/${pid}`);await mkdir(pd,{recursive:true});
    for(const kind of ['thumb','preview','web'])await writeFile(path.join(pd,`${kind}.webp`),source);
  }
  for(let n=1;n<=5;n++){
    const gid=Number(db.prepare('INSERT INTO galleries(event_id,public_id,name,created_at) VALUES(?,?,?,?)').run(id,'kid-'+n,'Kid '+(n===5?10:n),stamp).lastInsertRowid);
    const pid=n+1;
    db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(gid,pid);
    if(visual){const bytes=await readFile(path.join(visual,`collection-${n}.webp`));for(const kind of ['thumb','preview','web'])await writeFile(path.join(dataDir,`derivatives/${id}/${pid}/${kind}.webp`),bytes);}
  }
  db.prepare('UPDATE events SET share_photo_id=? WHERE id=?').run(photo,id);
  const before=Object.fromEntries(['photos','photo_files','galleries','gallery_photos'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+eventPath,{waitUntil:'networkidle'});

  const artifacts=process.env.REDESIGN_ARTIFACTS||'/tmp/picture-day-redesign-proof';await mkdir(artifacts,{recursive:true});
  const shot=async(name,target=page)=>target.screenshot({path:path.join(artifacts,name+'.png'),fullPage:false});
  const check=page.locator('[data-photo-check]');await check.first().click();
  const selected=await page.locator('[data-photo-check][aria-pressed="true"]').count();
  await page.getByRole('button',{name:'Collection overview',exact:true}).click();
  const overview=page.getByRole('region',{name:'Collection overview'});await expect(overview).toBeVisible();
  const names=await overview.locator('h3').allTextContents();assert.deepEqual(names,['Group','Kid 1','Kid 2','Kid 3','Kid 4','Kid 10']);
  assert.ok((await overview.locator('.collection-art').first().boundingBox()).width>=210);
  await shot('owner-collections');
  await overview.getByRole('searchbox').fill('Kid 2');await expect(overview.locator('article')).toHaveCount(1);
  await overview.getByRole('button',{name:'View photos in Kid 2',exact:true}).click();
  const browserDialog=page.getByRole('dialog',{name:'Browse collections',exact:true});await expect(browserDialog).toBeVisible();
  await browserDialog.getByRole('button',{name:'Back to photos',exact:true}).click();
  await page.getByRole('button',{name:'Photo grid',exact:true}).click();
  assert.equal(await page.locator('[data-photo-check][aria-pressed="true"]').count(),selected);
  ok('Large, naturally ordered collection overview supports search and inspection without clearing selection');
  await page.getByRole('button',{name:'Done selecting',exact:true}).click();
  await page.locator('[data-photo-select]').first().click();
  const preview=page.getByRole('dialog',{name:'Photo preview',exact:true});await expect(preview).toBeVisible();
  const firstSrc=await preview.locator('.review-current img').getAttribute('src');
  await preview.getByRole('button',{name:'Compare photos',exact:true}).click();
  await expect(preview.locator('.reference-photo img')).toHaveAttribute('src',firstSrc);
  await expect(preview.getByRole('status')).toHaveText('2 of 12');
  await preview.getByRole('navigation',{name:'Photo filmstrip'}).getByRole('button').nth(3).click();
  await expect(preview.getByRole('status')).toHaveText('4 of 12');
  await expect(preview.locator('.reference-photo img')).toHaveAttribute('src',firstSrc);
  await shot('owner-comparison');await page.keyboard.press('ArrowRight');await expect(preview.getByRole('status')).toHaveText('5 of 12');
  await preview.getByRole('button',{name:'End comparison',exact:true}).click();await expect(preview.locator('.reference-photo')).toHaveCount(0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('[data-photo-check][aria-pressed="true"]').count(),selected);
  ok('Filmstrip and comparison hold a reference while navigating; closing preserves selected photo IDs');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Collection overview',exact:true}).click();
  await overview.getByRole('searchbox').fill('');await shot('owner-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const parent=await browser.newContext({viewport:{width:1440,height:1000}});const family=await parent.newPage();family.on('pageerror',e=>errors.push(e.message));
  await family.goto(base+'/g/'+slug,{waitUntil:'networkidle'});
  await expect(family.locator('.album-hero-image img')).toBeVisible();await expect.poll(()=>family.locator('.album-hero-image img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  assert.equal(await family.getByText('Kid 1',{exact:true}).count(),0);await shot('parent-album',family);
  const heroSrc=await family.locator('.album-hero-image img').getAttribute('src');assert.ok(heroSrc.includes('/media/'+photo+'/cover960'));
  await family.getByRole('link',{name:'Browse all photos',exact:false}).click();await family.getByRole('button',{name:'Favorite photo 1',exact:true}).click();
  await family.goto(base+'/g/'+slug);await family.getByRole('link',{name:'♡ Favorites',exact:true}).click();
  await expect(family.getByRole('button',{name:/♥ Favorites/})).toHaveAttribute('aria-pressed','true');await expect(family.locator('article.photo-card')).toHaveCount(1);
  ok('Parent entrance uses the deliberately selected image, keeps child labels private, and opens saved favorites');
  await family.getByRole('button',{name:/All photos ·/}).click();await family.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();
  const modal=family.getByRole('dialog',{name:'Photo preview',exact:true});await modal.getByRole('button',{name:'Compare photos',exact:true}).click();
  await family.setViewportSize({width:390,height:844});await shot('parent-mobile-compare',family);
  assert.ok(await family.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok((await modal.boundingBox()).height<=844*.95);
  for(let n=0;n<8;n++)await family.keyboard.press('ArrowRight');
  const strip=modal.getByRole('navigation',{name:'Photo filmstrip'}),active=strip.locator('[aria-current="true"]');
  await expect.poll(async()=>{const s=await strip.boundingBox(),a=await active.boundingBox();return a.x>=s.x&&a.x+a.width<=s.x+s.width;}).toBe(true);
  await family.keyboard.press('Escape');await family.goto(base+'/g/'+slug,{waitUntil:'networkidle'});await shot('parent-mobile',family);
  assert.ok(await family.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  db.prepare('UPDATE events SET share_photo_id=NULL WHERE id=?').run(id);await family.reload();await expect(family.locator('.album-hero-image')).toHaveCount(0);
  db.prepare('UPDATE events SET password_hash=? WHERE id=?').run('locked-fixture',id);await family.reload();await expect(family.getByLabel('Gallery password')).toBeVisible();await expect(family.locator('.album-home')).toHaveCount(0);
  ok('Mobile comparison and gallery fit; unset cover does not pick a random child and locked gallery hides its content');
  for(const t of Object.keys(before))assert.deepEqual(db.prepare(`SELECT * FROM ${t}`).all(),before[t]);assert.deepEqual(errors,[]);
  ok('Saved photo identities, file versions and collection memberships are unchanged');
  console.log(JSON.stringify({passed:checks.length,checks}));
} catch(error){console.error(logs);throw error;}
finally{
  await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
  if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});
}
