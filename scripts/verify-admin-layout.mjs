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
  for(let n=2;n<=96;n++){
    const pid=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(group,'img'+n,`IMG_${n}.jpg`,stamp,stamp).lastInsertRowid);
    db.prepare('INSERT INTO gallery_photos VALUES(?,?)').run(group,pid);
    const pd=path.join(dataDir,`derivatives/${id}/${pid}`);await mkdir(pd,{recursive:true});
    for(const kind of ['thumb','preview'])await writeFile(path.join(pd,`${kind}.webp`),source);
  }
  const before=Object.fromEntries(['photos','photo_files','galleries','gallery_photos'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+eventPath,{waitUntil:'networkidle'});

  const tab = name => page.getByRole('tab',{name,exact:true});
  const settings=page.locator('#project-settings'),pricing=page.locator('#project-pricing');
  const selection=page.getByRole('region',{name:'Selected photo actions'});
  await expect(tab('Photos')).toHaveAttribute('aria-selected','true');
  await expect(settings).toBeHidden();await expect(pricing).toBeHidden();
  await page.locator('[data-photo-check]').nth(0).click();
  await page.locator('[data-photo-check]').nth(1).click();
  const selectionText=await selection.innerText();
  await page.evaluate(()=>window.scrollTo({top:2200,behavior:'instant'}));await delay(200);
  const y=await page.evaluate(()=>window.scrollY);
  const box=await tab('Settings').boundingBox();assert.ok(box.y>=0&&box.y<200);
  await tab('Settings').click();await expect(settings).toBeVisible();
  assert.ok((await settings.boundingBox()).y<250);
  await expect(page.locator('#project-photos')).toBeHidden();
  const fields=settings.locator('input[name=tagline]');await fields.fill('A private draft tagline');
  await tab('Photos').click();await expect.poll(()=>selection.innerText()).toBe(selectionText);
  assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-y)<10);
  await tab('Settings').click();await expect(fields).toHaveValue('A private draft tagline');
  ok('Sticky navigation reaches settings from deep in 96 photos; returning restores scroll and exact selection');
  await tab('Sharing').click();await expect(page.getByRole('region',{name:'Link preview'})).toBeVisible();
  await page.getByRole('button',{name:'Choose album photo',exact:true}).click();
  await page.getByRole('searchbox',{name:'Find preview photo or collection'}).fill('IMG_9');
  await tab('Photos').click();await tab('Sharing').click();
  await expect(page.getByRole('searchbox',{name:'Find preview photo or collection'})).toHaveValue('IMG_9');
  await tab('Settings').click();await expect(fields).toHaveValue('A private draft tagline');
  ok('Switching between all workspaces preserves settings and sharing drafts without submitting anything');
  await settings.getByRole('button',{name:'Save event settings',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT tagline FROM events WHERE id=?').get(id).tagline).toBe('A private draft tagline');
  await expect(settings.getByRole('status')).toHaveCount(0);
  await fields.fill('Second saved tagline');await settings.getByRole('button',{name:'Save event settings',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT tagline FROM events WHERE id=?').get(id).tagline).toBe('Second saved tagline');
  ok('Settings save repeatedly without resetting other fields or multiplying confirmation messages');
  await tab('Pricing').click();await expect(pricing).toBeVisible();
  const price=pricing.locator('input[inputmode=decimal]').first();assert.ok(await price.count());
  await price.fill('-5');await pricing.getByRole('button',{name:'Save event prices',exact:true}).click();
  await expect(pricing.getByRole('status')).toHaveText('Unsaved changes');
  await tab('Photos').click();await tab('Pricing').click();await expect(price).toHaveValue('-5');
  await price.fill('7.25');await pricing.getByRole('button',{name:'Save event prices',exact:true}).click();
  await expect(pricing.getByRole('status')).toHaveCount(0);
  ok('Pricing has its own workspace; invalid save retains the draft, valid save clears its dirty state');
  await tab('Settings').click();await fields.fill('Do not lose this');
  await expect(settings.getByRole('status')).toHaveText('Unsaved changes');
  let dialogs=0;page.once('dialog',d=>{dialogs++;void d.dismiss();});
  await page.getByRole('link',{name:'← All events',exact:true}).click();
  await expect.poll(()=>dialogs).toBe(1);
  await expect(fields).toHaveValue('Do not lose this');
  await settings.getByRole('button',{name:'Save event settings',exact:true}).click();
  await expect(settings.getByRole('status')).toHaveCount(0);
  await page.reload({waitUntil:'networkidle'});await expect(tab('Settings')).toHaveAttribute('aria-selected','true');
  await expect(fields).toHaveValue('Do not lose this');
  ok('Unsaved settings warn before leaving; direct settings hash and reload return to the settings workspace');
  await tab('Photos').click();await tab('Photos').focus();await page.keyboard.press('ArrowRight');
  await expect(tab('Sharing')).toBeFocused();await expect(tab('Sharing')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End');await expect(tab('Pricing')).toBeFocused();
  await page.keyboard.press('Home');await expect(tab('Photos')).toBeFocused();
  ok('Accessible tab keyboard controls support Left/Right and Home/End');
  await mkdir('/tmp/picture-day-admin-layout-proof',{recursive:true});
  await page.screenshot({path:'/tmp/picture-day-admin-layout-proof/desktop-photos.png'});
  await tab('Settings').click();await page.screenshot({path:'/tmp/picture-day-admin-layout-proof/desktop-settings.png'});
  await page.setViewportSize({width:390,height:844});
  for(const name of ['Settings','Pricing','Sharing','Photos']){
    await tab(name).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok((await tab(name).boundingBox()).width>=44);
  }
  await page.evaluate(()=>window.scrollTo({top:2500,behavior:'instant'}));await delay(100);
  assert.ok((await tab('Settings').boundingBox()).y<220);await tab('Settings').click();
  await page.screenshot({path:'/tmp/picture-day-admin-layout-proof/mobile-settings.png'});
  ok('All project sections fit mobile, with touch-size tabs and settings reachable from a scrolled grid');
  for(const t of Object.keys(before))assert.deepEqual(db.prepare(`SELECT * FROM ${t}`).all(),before[t]);
  assert.deepEqual(errors,[]);ok('Photo identities, files, collections and memberships are unchanged; no browser errors');
  console.log(JSON.stringify({passed:checks.length,checks}));
} catch(error){console.error(logs);throw error;}
finally{
  await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
  if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});
}
