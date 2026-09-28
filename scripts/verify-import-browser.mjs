// Real Chromium importer rehearsal. Always boots a disposable loopback-only build,
// creates a synthetic account, and removes its data afterward. Never uses live data.
// Run after `npm run build`: node scripts/verify-import-browser.mjs
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
const artifactDir = process.env.IMPORT_BROWSER_ARTIFACTS;
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
  if (conflict) { await expect(upload).toBeDisabled(); const review=page.getByRole('button',{name:'Review conflicts',exact:true}); if(await review.count()) { await expect(page.getByRole('region',{name:'Review conflicting files',exact:true})).toBeHidden(); await expect(review).toBeVisible(); await review.click(); } }
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

  // Actual filesystem directory selection, not synthetic JS File objects: this
  // exercises Chromium's webkitRelativePath handling that caused the regression.
  for (let i = 1; i <= 180; i++) {
    const name = `MtnKidsPicDay-${String(i).padStart(3, '0')}`;
    await Promise.all([
      file(`MtnKidsPicDay/full/${name}.jpg`, full),
      file(`MtnKidsPicDay/social/${name}.jpg`, social),
      file(`MtnKidsPicDay/raw/${name}.dng`, raw),
      ...(i <= 60 ? [file(`MtnKidsPicDay/raw/${name}.xmp`, xmp)] : [])
    ]);
  }
  const parentDirectory = path.join(scratch, 'exports', 'MtnKidsPicDay');
  const pickers = [primary, page.getByLabel('Choose full resolution folder', { exact: true }),
    page.getByLabel('Choose social copies folder', { exact: true }),
    page.getByLabel('Choose camera raw + edit files folder', { exact: true })];
  for (let i = 0; i < pickers.length; i++) {
    await pickers[i].setInputFiles(parentDirectory);
    await waitForPlan(180, 600);
    const versions = await page.locator('tbody select').evaluateAll(selects => selects.map(select => select.value));
    for (const role of ['print', 'social', 'raw']) assert.equal(versions.filter(value => value === role).length, 180);
    ok(`180-photo parent directory correctly classified through ${i === 0 ? 'primary chooser' : ['full', 'social', 'raw'][i - 1] + ' folder chooser'}`);
    if (i === 0) {
      await shot('180-photo-import-summary');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '390px import summary must not overflow the page');
      await shot('390px-import-summary');
      await page.setViewportSize({ width: 1440, height: 1000 });
      ok('390px import layout has no page-level horizontal overflow');
      await primary.setInputFiles(parentDirectory);
      await waitForPlan(180, 600);
      ok('Reselecting all 600 files preserves 180 photos without duplicate-copy prompts');
    }
    await clearSelection();
  }
  assert.equal(db.prepare('select count(*) n from photos').get().n, 0);
  ok('Clear selection resets all queued files without uploading or changing saved photos');

  for (const name of ['CHOICE_001.jpg', 'CHOICE_002.jpg']) {
    await file(`Original/full/${name}`, full);
    await file(`Revision/full/${name}`, updated);
  }
  const originalDir = path.join(scratch, 'exports', 'Original');
  const revisedDir = path.join(scratch, 'exports', 'Revision');
  await primary.setInputFiles(originalDir);
  await waitForPlan(2, 2);
  await primary.setInputFiles(revisedDir);
  await waitForPlan(2, 2, { conflict: true });
  await expect(page.getByText('Original/full', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Revision/full', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use incoming folder', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Keep queued folder', exact: true })).toHaveCount(1);
  await shot('genuine-conflict-folder-comparison');
  await page.getByRole('button', { name: 'Keep queued folder', exact: true }).click();
  await waitForPlan(2, 2);
  await primary.setInputFiles(revisedDir);
  await waitForPlan(2, 2, { conflict: true });
  await page.getByRole('button', { name: 'Use incoming folder', exact: true }).click();
  await waitForPlan(2, 2);
  await transfer(2);
  const chosen = db.prepare("select sha256 from photo_files where role='print'").all();
  assert.equal(chosen.length, 2);
  for (const row of chosen) assert.equal(row.sha256, sha256(updated));
  ok('Genuinely different files show both folders; one group choice uploads the incoming bytes');
  await clearSelection();

  // These are actual owner actions in the expanded row, not direct state edits.
  // The RAW keeps the photo row alive when its conflicting JPEG slot changes.
  for (const [name, action] of [['REMOVE_001', 'remove'], ['REASSIGN_001', 'reassign']]) {
    await file(`${name}-Original/full/${name}.jpg`, full);
    await file(`${name}-Original/raw/${name}.dng`, raw);
    await file(`${name}-Revision/full/${name}.jpg`, updated);
    await primary.setInputFiles(path.join(scratch, 'exports', `${name}-Original`));
    await waitForPlan(1, 2);
    await primary.setInputFiles(path.join(scratch, 'exports', `${name}-Revision`));
    await waitForPlan(1, 2, { conflict: true });
    const fullCell = page.locator('tbody tr td').nth(1);
    if (action === 'remove') await fullCell.getByRole('button', { name: 'Remove', exact: true }).click();
    else await fullCell.getByRole('combobox').selectOption('social');
    const count = action === 'remove' ? 2 : 3;
    await waitForPlan(1, count);
    await expect(page.getByRole('region', { name: 'File conflicts', exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Selected folders', exact: true })).toContainText(`${name}-Revision/full`);
    await transfer(count);
    const photo = db.prepare('select id from photos where stem=?').get(name.toLowerCase());
    assert.ok(photo);
    const versions = db.prepare('select role,sha256 from photo_files where photo_id=? order by role').all(photo.id);
    assert.deepEqual(versions, [
      { role: 'print', sha256: sha256(updated) }, { role: 'raw', sha256: sha256(raw) },
      ...(action === 'reassign' ? [{ role: 'social', sha256: sha256(full) }] : [])
    ]);
    ok(action === 'remove'
      ? 'Removing a queued JPEG with a RAW retained promotes its competing copy and uploads it'
      : 'Reassigning a queued JPEG preserves its bytes as social and promotes its competing print copy');
    await clearSelection();
  }

  await file('SmallRoll/full/PAIR_001.jpg', full);
  await file('SmallRoll/full/PAIR_002.jpg', full);
  await file('SmallRoll/social/PAIR_001.jpg', social);
  await primary.setInputFiles(path.join(scratch, 'exports', 'SmallRoll'));
  await waitForPlan(2, 3);
  await transfer(3);
  const before = db.prepare("select id,stem from photos where stem like 'pair_%' order by stem").all();
  assert.equal(before.length, 2);
  const pair1Files = db.prepare('select role,sha256 from photo_files where photo_id=? order by role').all(before[0].id);
  assert.deepEqual(pair1Files, [{ role: 'print', sha256: sha256(full) }, { role: 'social', sha256: sha256(social) }]);
  ok('Unequal full/social folders upload through the browser into one permanent photo per filename');
  await clearSelection();

  const laterSocial = await file('LooseSelection/PAIR_002.jpg', social);
  await page.getByLabel('Choose social copies files', { exact: true }).setInputFiles(laterSocial);
  await waitForPlan(1, 1);
  assert.deepEqual(await page.locator('tbody select').evaluateAll(selects => selects.map(select => select.value)), ['social']);
  await expect(page.locator('tbody')).toContainText('Linked to existing photo');
  await transfer(1);
  assert.deepEqual(db.prepare("select id,stem from photos where stem like 'pair_%' order by stem").all(), before);
  const pair2Files = db.prepare('select role,sha256 from photo_files where photo_id=? order by role').all(before[1].id);
  assert.deepEqual(pair2Files, [{ role: 'print', sha256: sha256(full) }, { role: 'social', sha256: sha256(social) }]);
  ok('Loose-file social picker remains social and later upload preserves existing photo IDs');

  await clearSelection();
  await primary.setInputFiles(originalDir);
  await waitForPlan(2, 2);
  // Hold real file reads so navigation deterministically happens mid-comparison.
  // Releasing them after teardown must not resurrect the unmounted queue or
  // overwrite the new page's recovery state.
  await page.evaluate(() => {
    const native = Blob.prototype.arrayBuffer;
    window.__pendingImportReads = [];
    window.__restoreImportReads = () => { Blob.prototype.arrayBuffer = native; };
    Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        native.call(this).then(bytes => window.__pendingImportReads.push(() => resolve(bytes)), reject);
      });
    };
  });
  await primary.setInputFiles(originalDir);
  await page.waitForFunction(() => window.__pendingImportReads.length >= 2);
  await expect(primary).toBeDisabled();
  await page.getByRole('link', { name: '← Back to Synthetic Lightroom exports', exact: true }).click();
  await page.waitForURL(base + eventPath);
  const sentinel = JSON.stringify({ version: 2, total: 0, done: 0, entries: {}, navigationProbe: true });
  const preserved = await page.evaluate(async ({ key, value }) => {
    localStorage.setItem(key, value);
    window.__restoreImportReads();
    for (const release of window.__pendingImportReads.splice(0)) release();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return localStorage.getItem(key);
  }, { key: `picture-day-import-1-${eventId}`, value: sentinel });
  assert.equal(preserved, sentinel);
  ok('Navigating away during duplicate-file comparison does not overwrite recovery state after teardown');
  assert.deepEqual(pageErrors, []);
  ok('No browser JavaScript exceptions across selection, resolution, clearing, and uploads');
  console.log(JSON.stringify({ passed: checks.length, checks, screenshots }, null, 2));
} catch (error) {
  if (page && artifactDir) await shot('failure').catch(() => {});
  console.error('Importer browser rehearsal failed:', error);
  console.error('Disposable fixture logs:\n' + logs);
  throw error;
} finally {
  await browser?.close();
  db?.close();
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  clearTimeout(timer);
  await rm(scratch, { recursive: true, force: true });
}
