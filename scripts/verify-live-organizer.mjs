// Disposable browser rehearsal: uploads in one tab, sorting in another.
// No production data, accounts, or network destinations are used.
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-live-organizer-'));
const dataDir = path.join(scratch, 'data');
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, cookie = '';
server.stdout.on('data', b => { logs = (logs + b).slice(-8000); });
server.stderr.on('data', b => { logs = (logs + b).slice(-8000); });
const errors = [], checks = [];
const pass = text => { checks.push(text); console.log(`PASS ${text}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const jpeg = await sharp({create:{width:800,height:600,channels:3,background:'#5a899e'}}).jpeg().toBuffer();
const request = (url, options = {}) => fetch(base + url, { redirect:'manual', ...options,
  headers:{origin:base, accept:'text/html', cookie, ...options.headers}, signal:AbortSignal.timeout(15000) });
const form = values => ({method:'POST',body:new URLSearchParams(values)});
try {
  for(let i=0;i<100;i++) { try { if((await request('/healthz')).ok) break; } catch {}
    if(i===99 || server.exitCode!==null) throw Error(logs); await delay(100); }
  let r = await request('/setup', form({email:'live-organizer@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Live organizer fixture'}));
  assert.equal(r.status,303); cookie = r.headers.get('set-cookie').split(';')[0];
  r = await request('/admin?/create',form({name:'Concurrent upload fixture'}));
  const eventPath = r.headers.get('location'), eventId = Number(eventPath.split('/').at(-1));
  await request(eventPath+'/upload');
  db = new Database(path.join(dataDir,'db/app.sqlite'));
  const intake = db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
  const upload = async n => {
    const r = await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`SHOT_${n}.jpg`,role:'print'}),{method:'PUT',body:jpeg,headers:{'content-type':'application/octet-stream'}});
    assert.equal(r.status,200); const id = (await r.json()).photoId;
    await expect.poll(()=>db.prepare('SELECT rendition_status s FROM photos WHERE id=?').get(id)?.s,{timeout:20000}).toBe('ready');
    return id;
  };
  const first = await upload(1);
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath) for(const p of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']) { try {await access(p);executablePath=p;break;}catch{} }
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const ctx=await browser.newContext({viewport:{width:1280,height:1000}});
  const split=cookie.indexOf('='); await ctx.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+eventPath,{waitUntil:'networkidle'});
  const cards=page.locator('main [data-photo-select]');
  await expect(cards).toHaveCount(1);
  await expect.poll(()=>cards.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await page.locator(`[data-photo-check="${first}"]`).click();
  const second=await upload(2);
  if(process.env.DIAGNOSE_ONLY==='1') {
    await delay(11500);
    console.log(JSON.stringify({serverPhotos:db.prepare('SELECT count(*) n FROM photos').get().n,visiblePhotos:await cards.count(),selected:await page.locator('[data-photo-check][aria-pressed="true"]').count()}));
  } else {
    await expect(cards).toHaveCount(2,{timeout:15000});
    await expect.poll(()=>cards.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
    await expect(page.locator(`[data-photo-check="${first}"]`)).toHaveAttribute('aria-pressed','true');
    pass('A fully ready sorting tab discovers later uploads and displays thumbnails without losing selection');
    // Mimic a preview finishing while its photo is already in a focused draft.
    db.prepare("UPDATE photos SET rendition_status='pending' WHERE id=?").run(second);
    await page.reload({waitUntil:'networkidle'});
    await page.locator(`[data-photo-check="${second}"]`).click();
    await page.getByRole('button',{name:'Organize 1 photo',exact:true}).click();
    const batch=page.getByRole('dialog',{name:'Organize photos',exact:true});
    await expect(batch).toBeVisible();
    await batch.locator('#new-child-collection').fill('Draft child');
    await batch.getByRole('button',{name:'+ Create & assign selected',exact:true}).click();
    await expect(batch.getByRole('checkbox',{name:'Assign Draft child',exact:true})).toBeChecked();
    await batch.locator(`[data-photo-select="${second}"]`).click();
    const closer=page.getByRole('dialog',{name:'Closer look at batch photo',exact:true});
    await expect(closer).toBeVisible();
    db.prepare("UPDATE photos SET rendition_status='ready' WHERE id=?").run(second);
    await expect.poll(()=>batch.locator(`[data-photo-select="${second}"] img`).evaluateAll(images=>images.length===1&&images[0].complete&&images[0].naturalWidth>0),{timeout:15000}).toBe(true);
    await expect.poll(()=>closer.locator('img').evaluateAll(images=>images.length===1&&images[0].complete&&images[0].naturalWidth>0)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(closer).not.toBeVisible();
    await expect(batch.getByRole('checkbox',{name:'Assign Draft child',exact:true})).toBeChecked();
    await expect(batch.locator(`[data-photo-check="${second}"]`)).toHaveAttribute('aria-pressed','true');
    assert.equal(db.prepare("SELECT count(*) n FROM galleries WHERE name='Draft child'").get().n,0);
    pass('A finishing preview updates inside the focused batch without saving or losing draft assignments');
    const revision=await request(`/admin/api/events/${eventId}/photo-state`);
    assert.equal(revision.status,200); assert.equal(revision.headers.get('cache-control'),'private, no-store');
    assert.match((await revision.json()).revision,/^[a-f0-9]{64}$/);
    const anonymous=await fetch(base+`/admin/api/events/${eventId}/photo-state`,{redirect:'manual'});
    assert.equal(anonymous.status,401);
    pass('The small state probe is authenticated and not cached');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:checks.length,checks}));
  }
} finally {
  await browser?.close(); db?.close(); server.kill('SIGTERM');
  if(server.exitCode===null&&server.signalCode===null) await once(server,'exit');
  await rm(scratch,{recursive:true,force:true});
}
