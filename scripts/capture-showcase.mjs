// Capture real UI against disposable synthetic data. Never accepts a live target.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

assert.equal(process.argv.length, 2, 'No arguments: captures always use a fresh local fixture.');
await access('build/index.js');
const fixture = JSON.parse(await readFile('scripts/fixtures/showcase/manifest.json', 'utf8'));
const scratch = await mkdtemp(path.join(tmpdir(), 'gatherframe-showcase-'));
const dataDir = path.join(scratch, 'data'), photoDir = path.join(scratch, 'photos');
const output = 'docs/screenshots';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let child, browser, db;
const errors = [], assets = [];
async function capture(page, name, alt) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('div[aria-live=polite] > div')).toHaveCount(0);
  // Load images via actual scrolling, then return to the top. No DOM/UI replacement.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 60));
    }
    scrollTo(0, 0);
  });
  await expect.poll(() => page.locator('img:visible').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  await page.mouse.move(0, 0);
  const file = `${output}/${name}.webp`;
  const bytes = await sharp(await page.screenshot({ animations: 'disabled', fullPage: ['gallery-desktop', 'proof-selection'].includes(name) })).webp({ quality: 86 }).toBuffer();
  await writeFile(file, bytes);
  const { width, height } = await sharp(bytes).metadata();
  assets.push({ file, alt, width, height, bytes: bytes.length, sha256: sha256(bytes) });
  console.log(`Captured ${name}: ${width} × ${height}, ${Math.round(bytes.length / 1024)} KiB`);
}
try {
  await mkdir(photoDir); await mkdir(output, { recursive: true });
  for (const asset of fixture.assets) {
    assert.match(asset.file, /^scripts\/fixtures\/showcase\/[a-z-]+\.webp$/);
    const bytes = await readFile(asset.file);
    assert.equal(sha256(bytes), asset.sha256, 'Fixture fingerprint differs');
    await sharp(bytes).png().toFile(path.join(photoDir, path.basename(asset.file, '.webp') + '.png'));
  }
  execFileSync(process.execPath, ['scripts/seed-demo.mjs', dataDir, photoDir], { env, stdio: 'pipe', timeout: 60000 });
  db = new Database(path.join(dataDir, 'db/app.sqlite'));
  db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=5000');
  const now = new Date().toISOString();
  const session = randomBytes(32).toString('hex');
  const user = db.prepare('SELECT id FROM admin_users').get();
  db.prepare('INSERT INTO admin_sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sha256(session), user.id, new Date(Date.now() + 86400000).toISOString(), now);
  db.prepare("UPDATE settings SET value=? WHERE key='studioName'").run(JSON.stringify({ v: 'Fieldwork Studio' }));
  db.prepare("UPDATE events SET gallery_layout='simple',ordering_enabled=0,parent_message=? WHERE id=1").run('A study in light, texture and quiet places. Explore the coast, woodland and meadow.');
  for (const [id, title, description] of [[2, 'Coast', 'First light and the rhythm of the tide.'], [3, 'Woodland', 'Soft mist, tall trees and the smallest details.'], [4, 'Meadow', 'Late afternoon in bloom.']]) {
    db.prepare('UPDATE galleries SET public_title=?,public_description=? WHERE id=?').run(title, description, id);
  }
  // Stable illustrative order timestamps, unrelated to real customer activity.
  db.prepare("UPDATE orders SET created_at='2026-09-28T16:00:00.000Z',updated_at='2026-09-28T16:00:00.000Z'").run();
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { env: { ...env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '0', DEMO_MODE: '0', HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => logs = (logs + bytes).slice(-6000));
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch {}
    if (i === 199 || child.exitCode !== null) throw Error('Disposable server failed: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome']) {
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const options = { viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' };
  const owner = await browser.newContext(options), guest = await browser.newContext(options);
  const mobile = await browser.newContext({ ...options, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const context of [owner, guest, mobile]) {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  }
  await owner.addCookies([{ name: 'pk_admin', value: session, url: base }]);
  const admin = await owner.newPage(), gallery = await guest.newPage(), phone = await mobile.newPage();
  await gallery.goto(base + '/g/field-notes', { waitUntil: 'networkidle' });
  await expect(gallery.getByRole('heading', { name: 'Field notes', exact: true })).toBeVisible();
  await capture(gallery, 'gallery-desktop', 'A simple guest gallery presenting six nature photographs with collection and tag filters.');
  await phone.goto(base + '/g/field-notes', { waitUntil: 'networkidle' });
  await phone.getByRole('button', { name: 'Take a closer look at photo 2', exact: true }).click();
  await expect(phone.locator('.gatherframe-viewer')).toHaveAttribute('data-photo-id', '2');
  await capture(phone, 'gallery-mobile', 'A full-screen photograph on a phone with navigation, favorite and download controls.');
  await admin.goto(base + '/admin/events/1', { waitUntil: 'networkidle' });
  await admin.getByRole('tab', { name: 'Photos', exact: true }).click();
  await capture(admin, 'studio-organize', 'The photographer workspace with shared photo library, collections, tags and bulk actions.');
  await admin.getByRole('tab', { name: 'Presentation', exact: true }).click();
  await admin.getByLabel('Gallery layout', { exact: true }).selectOption('sections');
  await admin.getByRole('button', { name: 'Save gallery layout', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT gallery_layout FROM events WHERE id=1').get().gallery_layout).toBe('sections');
  await gallery.reload({ waitUntil: 'networkidle' });
  await capture(gallery, 'gallery-story', 'The same project presented with a cover photograph and named chapter navigation.');
  await admin.goto(base + '/admin/events/1/access', { waitUntil: 'networkidle' });
  const label = 'Editorial selections — sample client';
  await admin.getByLabel('Private recipient label', { exact: true }).fill(label);
  await admin.locator('input[name=collections][value="2"]').check();
  await admin.locator('input[name=collections][value="3"]').check();
  await admin.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(admin.getByLabel('New invitation link', { exact: true })).toBeVisible();
  const token = (await admin.getByLabel('New invitation link', { exact: true }).inputValue()).split('/').at(-1);
  // Remove the one-time invitation display before any studio capture.
  await admin.reload({ waitUntil: 'networkidle' });
  await admin.getByLabel('Selection title for ' + label, { exact: true }).fill('Choose your exhibition prints');
  await admin.getByRole('article').filter({ has: admin.getByRole('heading', { name: label, exact: true }) }).getByRole('button', { name: 'Create selection round', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT count(*) n FROM proof_rounds').get().n).toBe(1);
  const round = db.prepare('SELECT id FROM proof_rounds').get().id;
  await gallery.goto(`${base}/g/${token}/proofs/${round}`, { waitUntil: 'networkidle' });
  await gallery.getByLabel('Photo 1', { exact: true }).check();
  await gallery.getByLabel('Photo 3', { exact: true }).check();
  await gallery.getByLabel('Note for Photo 1', { exact: true }).fill('Keep the warm morning light.');
  await gallery.getByLabel('Message to your photographer', { exact: true }).fill('These two would make a lovely pair for the exhibition.');
  await gallery.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(gallery.getByRole('status')).toHaveText('Draft saved.');
  await gallery.reload({ waitUntil: 'networkidle' });
  await capture(gallery, 'proof-selection', 'A recipient saves two selected photographs, an image note and a message before submission.');
  await gallery.getByRole('button', { name: 'Submit selection', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT status FROM proof_rounds').get().status).toBe('submitted');
  await admin.goto(`${base}/admin/events/1/proofs/${round}`, { waitUntil: 'networkidle' });
  await capture(admin, 'proof-review', 'The photographer reviews a submitted selection and notes, with accept and reopen controls.');
  db.prepare('UPDATE events SET ordering_enabled=1 WHERE id=1').run();
  await admin.goto(base + '/admin/orders', { waitUntil: 'networkidle' });
  await expect(admin.getByRole('heading', { name: 'The print table', exact: true })).toBeVisible();
  await capture(admin, 'print-orders', 'The print-order inbox tracks fictional orders, manually recorded payments and production status.');
  await admin.goto(base + '/admin', { waitUntil: 'networkidle' });
  await admin.getByLabel('Name', { exact: true }).fill('Your first shoot');
  await admin.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(admin.getByText(/First delivery guide/)).toBeVisible();
  await capture(admin, 'first-delivery', 'A new private project shows the four-step first-delivery guide before any photographs are imported.');
  assert.deepEqual(errors, [], 'Browser errors');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(`${output}/manifest.json`, JSON.stringify({ sourceRevision, capture: 'Real Chromium UI; disposable local database; original AI-generated sample photographs; fictional customer records; mobile viewport emulation.', assets }, null, 2) + '\n');
  console.log(`Verified ${assets.length} screenshots; no browser errors. Temporary studio removed on exit.`);
} finally {
  await browser?.close(); db?.close();
  if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  await rm(scratch, { recursive: true, force: true });
}
