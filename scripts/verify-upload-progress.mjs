// Upload-review disclosure and progress regression. Boots a disposable loopback-only build,
// creates a synthetic account, and removes its data afterward. Never uses live data.
// Run after `npm run build`: node scripts/verify-upload-progress.mjs
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-import-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.UPLOAD_PROGRESS_ARTIFACTS;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, page;
child.stdout.on('data', buffer => { logs = (logs + buffer).slice(-12000); });
child.stderr.on('data', buffer => { logs = (logs + buffer).slice(-12000); });
const checks = [], pageErrors = [], screenshots = [];
const ok = name => { checks.push(name); console.log(`PASS ${name}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const full = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#6699aa' } }).jpeg().toBuffer();
const social = await sharp(full).resize(48, 32).jpeg().toBuffer();
const updated = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ab7755' } }).jpeg().toBuffer();
const raw = await sharp(full).tiff().toBuffer();
const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4" /></rdf:RDF></x:xmpmeta>');
async function file(relative, contents) {
  const target = path.join(scratch, 'exports', relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}
async function shot(name) {
  if (!artifactDir) return;
  const target = path.join(artifactDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: false });
  screenshots.push(target);
}
async function waitForPlan(photoCount, fileCount, { conflict = false } = {}) {
  await expect(page.getByRole('heading', { name: `${photoCount} photos · ${fileCount} files`, exact: true })).toBeVisible({ timeout: 30000 });
  // Selection handlers read matching files asynchronously. Re-enabled inputs
  // establish that comparisons have finished, not merely the first DOM update.
  await expect(page.locator('input[type=file]').first()).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('tbody tr')).toHaveCount(photoCount);
  const upload = page.getByRole('button', { name: 'Upload files', exact: true });
  if (conflict) await expect(upload).toBeDisabled();
  else {
    await expect(upload).toBeEnabled({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Use incoming folder', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Two copies for the same version', exact: true })).toHaveCount(0);
  }
}
async function clearSelection() {
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload files', exact: true })).toHaveCount(0);
}
async function transfer(count) {
  await page.getByRole('button', { name: 'Upload files', exact: true }).click();
  await expect(page.getByText(`${count} transferred`, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Pause uploads', exact: true })).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Retry unfinished files', exact: true })).toBeDisabled();
  assert.equal(await page.locator('tbody').getByText(/Upload failed|Connection interrupted|need attention/).count(), 0);
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* fresh server boot */ }
    if (i === 99 || child.exitCode !== null) throw new Error('Fixture failed to start: ' + logs);
    await delay(100);
  }
  const request = (url, body, cookie) => fetch(base + url, { method: 'POST', redirect: 'manual',
    headers: { origin: base, accept: 'text/html', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body) });
  let response = await request('/setup', { email: 'import-browser@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Import browser fixture' });
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  response = await request('/admin?/create', { name: 'Synthetic Lightroom exports' }, cookie);
  assert.equal(response.status, 303);
  const eventPath = response.headers.get('location');
  const eventId = Number(eventPath.split('/').at(-1));
  assert.ok(eventId);
  db = new Database(path.join(dataDir, 'db/app.sqlite'));

  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) {
    for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome']) {
      try { await access(candidate); executablePath = candidate; break; } catch { /* another Chromium installation */ }
    }
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const equals = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + eventPath + '/upload', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Upload photos', exact: true })).toBeVisible();
  const primary = page.getByLabel(/^(Choose export parent folder|Choose a common parent folder)$/);

  await page.getByLabel('Choose full resolution files', { exact: true }).setInputFiles(Array.from({length:15},(_,i)=>({name:`PROGRESS_${i+1}.jpg`,mimeType:'image/jpeg',buffer:full})));
  await waitForPlan(15,15);
  const review=page.locator('details').filter({has:page.locator('summary', {hasText:'Review 15 photos and their versions'})});
  await expect(review).not.toHaveAttribute('open','');
  await review.locator('summary').click();await expect(review).toHaveAttribute('open','');
  await page.getByRole('button',{name:'Upload files',exact:true}).click();
  await expect(page.getByText('15 transferred',{exact:true})).toBeVisible({timeout:60000});
  await expect(review).toHaveAttribute('open','');
  ok('Manual review disclosure survives a 15-file upload and final inventory refresh');
  const overall=page.getByRole('progressbar',{name:'Upload bytes received',exact:true});
  await expect(overall).toHaveAttribute('value',String(15*full.length));await expect(overall).toHaveAttribute('max',String(15*full.length));
  await page.locator('tbody tr').last().scrollIntoViewIfNeeded();
  await expect.poll(async()=>{const b=await overall.boundingBox();return !!b&&b.y>=0&&b.y+b.height<=page.viewportSize().height;}).toBe(true);
  await shot('sticky-progress-desktop');ok('Confirmed-file progress stays visible while scrolling through the expanded photo rows');
  await page.getByLabel('Choose full resolution files',{exact:true}).setInputFiles([{name:'PROGRESS_16.jpg',mimeType:'image/jpeg',buffer:full}]);
  const reviewAll=page.locator('details').filter({has:page.locator('summary',{hasText:/Review \d+ photos and their versions/})});
  await expect(reviewAll).toHaveAttribute('open','');await expect(page.locator('tbody tr')).toHaveCount(16);
  await page.getByRole('button',{name:'Retry unfinished files',exact:true}).click();await expect(page.getByText('16 transferred',{exact:true})).toBeVisible();await expect(reviewAll).toHaveAttribute('open','');
  ok('Adding another file and resuming a large batch keeps a manually expanded review open');
  await clearSelection();
  const before=db.prepare('SELECT id,sha256,photo_id,role FROM photo_files ORDER BY id').all();
  let failOnce=true;
  const uploadPattern='**/admin/api/events/*/transfers';
  await page.route(uploadPattern,async route=>{
    if(failOnce&&route.request().postDataJSON()?.filename==='SMALL_2.jpg'){
      failOnce=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic interrupted transfer'})});
    }else await route.continue();
  });
  await page.getByLabel('Choose full resolution files',{exact:true}).setInputFiles([1,2].map(n=>({name:`SMALL_${n}.jpg`,mimeType:'image/jpeg',buffer:full})));
  await waitForPlan(2,2);await expect(reviewAll).toHaveAttribute('open','');
  await reviewAll.locator('summary').click();await expect(reviewAll).not.toHaveAttribute('open','');
  await page.getByRole('button',{name:'Upload files',exact:true}).click();await expect(page.getByText('1 transferred · 1 need attention',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pause uploads',exact:true})).toHaveCount(0);
  await expect(reviewAll).not.toHaveAttribute('open','');await expect(overall).toHaveAttribute('value',String(full.length));await expect(overall).toHaveAttribute('max',String(2*full.length));
  ok('A manually collapsed small batch stays collapsed through upload failure and inventory refresh; progress counts only confirmed transfers');
  await reviewAll.locator('summary').click();await expect(reviewAll).toHaveAttribute('open','');
  await page.getByRole('button',{name:'Retry unfinished files',exact:true}).click();await expect(page.getByText('2 transferred',{exact:true})).toBeVisible();await expect(reviewAll).toHaveAttribute('open','');await expect(overall).toHaveAttribute('value',String(2*full.length));
  await page.unroute(uploadPattern);ok('Opening review again survives a successful retry without duplicating already transferred files');
  await page.setViewportSize({width:390,height:844});await page.locator('tbody tr').last().scrollIntoViewIfNeeded();await expect.poll(async()=>{const b=await overall.boundingBox();return !!b&&b.y>=0&&b.y+b.height<=844;}).toBe(true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('sticky-progress-mobile');
  assert.deepEqual(db.prepare('SELECT id,sha256,photo_id,role FROM photo_files WHERE id<=? ORDER BY id').all(before.at(-1).id),before);
  const finalFiles=db.prepare('SELECT sha256 FROM photo_files').all();assert.equal(finalFiles.length,18);assert.ok(finalFiles.every(f=>f.sha256===sha256(full)));assert.deepEqual(pageErrors,[]);ok('Mobile progress remains visible; retries preserve exact file bytes and photo identities with no browser errors');
  console.log(JSON.stringify({passed:checks.length,checks,screenshots},null,2));
} catch(error) {if(page&&artifactDir)await shot('failure').catch(()=>{});console.error(error);throw error;}
finally {await browser?.close();db?.close();child.kill('SIGTERM');if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');await rm(scratch,{recursive:true,force:true});}
