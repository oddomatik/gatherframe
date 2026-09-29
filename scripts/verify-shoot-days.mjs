// Disposable production-build/browser rehearsal for Gatherframe labels.
// Run after npm run build: node scripts/verify-shoot-days.mjs
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
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-days-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.SHOOT_DAYS_ARTIFACTS;
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
const full = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#6699aa' } }).jpeg().toBuffer();
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
async function assertVisible(ids) { await expect.poll(() => visibleIds(page)).toEqual(ids); }
async function dayLink(day, count) {
  await page.getByRole('navigation', { name: 'Picture day', exact: true }).getByRole('link', { name: `${day === null ? 'All days' : 'Day ' + day} · ${count}`, exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe(day === null ? null : String(day));
}
async function countLinks(all, day1, day2) {
  const nav = page.getByRole('navigation', { name: 'Picture day', exact: true });
  for (const [name, n] of [['All days', all], ['Day 1', day1], ['Day 2', day2]])
    await expect(nav.getByRole('link', { name: `${name} · ${n}`, exact: true })).toBeVisible();
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/healthz')).ok) break; } catch { /* fresh server startup */ }
    if (i === 99 || child.exitCode !== null) throw new Error('Fixture failed to start: ' + logs);
    await delay(100);
  }
  let r = await request('/setup', form({ email: 'shoot-days@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Two playful days' }));
  assert.equal(r.status, 303); cookie = r.headers.get('set-cookie').split(';')[0];
  r = await request('/admin?/create', form({ name: 'Synthetic two-day shoot' })); assert.equal(r.status, 303);
  const eventPath = r.headers.get('location'), eventId = Number(eventPath.split('/').at(-1)); assert.ok(eventId);
  // Opening the uploader initializes its private intake collection, as in the owner flow.
  r = await request(eventPath + '/upload'); assert.equal(r.status, 200);
  db = new Database(path.join(dataDir, 'db/app.sqlite')); db.pragma('foreign_keys = ON');
  assert.ok(db.prepare('PRAGMA table_info(photos)').all().some(row => row.name === 'shoot_day'), 'Build includes shoot_day migration');
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  const intake = db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
  const addGallery = (publicId, name, archived = 0) => Number(db.prepare('INSERT INTO galleries(event_id,public_id,name,is_archived,created_at) VALUES (?,?,?,?,?)').run(eventId, publicId, name, archived, new Date().toISOString()).lastInsertRowid);
  const alpha = addGallery('alpha', 'PRIVATE_CHILD_ALPHA_8472');
  const beta = addGallery('beta', 'PRIVATE_CHILD_BETA_8472');
  const archived = addGallery('archived', 'PRIVATE_ARCHIVED_8472', 1);
  const empty = addGallery('pending-only', 'PRIVATE_PENDING_8472');
  const upload = (gallery, name, bytes, day = undefined, role = 'print', replacement = 'reject') => request(`/admin/api/events/${eventId}/upload?` + new URLSearchParams({ gallery: String(gallery), filename: name, role, replacement, ...(day === undefined ? {} : { shootDay: String(day) }) }), { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' } });
  async function createPhoto(gallery, name, day) { const result = await upload(gallery, `${name}.jpg`, full, day); assert.equal(result.status, 200, await result.clone().text()); return (await result.json()).photoId; }
  const a1 = await createPhoto(alpha, 'A_DAY1', 1), a2 = await createPhoto(alpha, 'A_DAY2_SHARED', 2), a0 = await createPhoto(alpha, 'A_UNLABELED');
  const b2 = await createPhoto(beta, 'B_DAY2', 2), private1 = await createPhoto(intake, 'PRIVATE_INTAKE', 1);
  // Archived collections cannot receive imports; archive after this synthetic upload.
  db.prepare('UPDATE galleries SET is_archived=0 WHERE id=?').run(archived);
  const archived2 = await createPhoto(archived, 'PRIVATE_ARCHIVED', 2);
  db.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(archived);
  const pending2 = await createPhoto(alpha, 'PRIVATE_UNREADY', 2), pendingOnly = await createPhoto(empty, 'PRIVATE_PENDING_ONLY', 1);
  db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES (?,?)').run(beta, a2);
  await waitReady([a1, a2, a0, b2, private1, archived2, pending2, pendingOnly]);
  db.prepare("UPDATE photos SET rendition_status='failed' WHERE id IN (?,?)").run(pending2, pendingOnly);
  db.prepare('UPDATE galleries SET cover_photo_id=? WHERE id=?').run(a1, alpha);
  db.prepare('UPDATE galleries SET cover_photo_id=? WHERE id=?').run(a2, beta);
  db.prepare('UPDATE events SET is_published=1 WHERE id=?').run(eventId);
  ok('Real JPEG uploads create day-labeled and unlabeled photos; synthetic child spans both days and friends shot shares one ID');

  r = await upload(alpha, 'A_DAY1.jpg', social, 2, 'social'); assert.equal(r.status, 200); assert.equal((await r.json()).photoId, a1);
  r = await upload(alpha, 'A_DAY1.jpg', full, 2); assert.equal((await r.json()).status, 'unchanged');
  r = await upload(alpha, 'A_DAY1.jpg', updated, 2, 'print', 'replace'); assert.equal((await r.json()).status, 'replaced');
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a1).shoot_day, 1);
  r = await upload(intake, 'SIDECAR_FIRST.xmp', xmp, 2, 'raw'); assert.equal(r.status, 200); const sidecarPhoto = (await r.json()).photoId;
  r = await upload(intake, 'SIDECAR_FIRST.jpg', full, 1); assert.equal((await r.json()).photoId, sidecarPhoto);
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(sidecarPhoto).shoot_day, 2);
  await waitReady([a1, sidecarPhoto]);
  ok('Later social variants, identical retries, replacements, and sidecar-first pairs preserve the original day and permanent ID');
  const photoCount = db.prepare('SELECT count(*) n FROM photos').get().n;
  for (const malformed of ['3', '0', '-1', 'day1', '1.5', '1 OR 1=1']) { r = await upload(intake, 'INVALID.jpg', full, malformed); assert.equal(r.status, 400, malformed); }
  assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n, photoCount);
  ok('Malformed upload days fail before creating files or photos');

  // A real order snapshot makes non-destructive day relabeling an explicit contract.
  const now = new Date().toISOString();
  const order = Number(db.prepare(`INSERT INTO orders(order_number,access_token,idempotency_key,event_id,gallery_id,customer_name,subtotal_cents,total_cents,currency,created_at,updated_at) VALUES ('DAY-TEST','synthetic-day-order','synthetic-day-idem',?,?, 'Synthetic parent',100,100,'USD',?,?)`).run(eventId, alpha, now, now).lastInsertRowid);
  const item = Number(db.prepare(`INSERT INTO order_items(order_id,product_code,product_name,product_kind,quantity,unit_price_cents,total_cents) VALUES (?,'synthetic','Synthetic print','print',1,100,100)`).run(order).lastInsertRowid);
  const sheet = Number(db.prepare(`INSERT INTO order_item_sheets(order_item_id,sheet_index,template_code,label,paper_width_in,paper_height_in) VALUES (?,0,'synthetic','Synthetic',8,10)`).run(item).lastInsertRowid);
  db.prepare(`INSERT INTO order_item_cells(order_item_sheet_id,cell_index,print_size_code,label,w_in,h_in,x_in,y_in,photo_id,photo_stem,gallery_id,gallery_name,print_sha256) VALUES (?,0,'8x10','Synthetic',8,10,0,0,?,'a_day2_shared',?,'Synthetic child',?)`).run(sheet, a2, alpha, sha256(full));
  const snapshot = () => Object.fromEntries(['photos','photo_files','gallery_photos','orders','order_items','order_item_sheets','order_item_cells'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => { const copy = { ...row }; if (table === 'photos') delete copy.shoot_day; return copy; })]));
  const foreignEvent = Number(db.prepare(`INSERT INTO events(slug,name,variant_policy,created_at,updated_at) VALUES ('foreign-synthetic','Unrelated event','{}',?,?)`).run(now, now).lastInsertRowid);
  const foreignGallery = Number(db.prepare(`INSERT INTO galleries(event_id,public_id,name,created_at) VALUES (?,'foreign-private','Foreign private',?)`).run(foreignEvent, now).lastInsertRowid);
  const foreignPhoto = Number(db.prepare(`INSERT INTO photos(gallery_id,stem,display_name,shoot_day,created_at,updated_at) VALUES (?,'foreign','Foreign',1,?,?)`).run(foreignGallery, now, now).lastInsertRowid);
  db.prepare('UPDATE photos SET taken_at=? WHERE id IN (?,?)').run('2026-09-24T12:00:00Z', a1, a0);
  db.prepare('UPDATE photos SET taken_at=? WHERE id IN (?,?)').run('2026-09-25T12:00:00Z', a2, b2);
  const before = snapshot();
  const assign = (ids, day, authenticated = true) => request(`${eventPath}?/setShootDay`, form([...ids.map(id => ['photoId', String(id)]), ['shootDay', String(day)]]), authenticated);
  r = await assign([a2], 1, false); assert.equal(r.status, 401);
  r = await assign([a2, a2], 1); assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a2).shoot_day, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM gallery_photos WHERE photo_id=?').get(a2).n, 2);
  assert.deepEqual(snapshot(), before);
  for (const invalid of ['3', '-1', '1.5']) { r = await assign([a2], invalid); assert.equal(r.status, 400); }
  r = await assign([a2, 999999], 2); assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a2).shoot_day, 1);
  r = await assign([a2, foreignPhoto], 2); assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a2).shoot_day, 1);
  assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(foreignPhoto).shoot_day, 1);
  r = await request(`${eventPath}?/setShootDay`, form([['photoId', String(a2)]])); assert.equal(r.status, 400);
  r = await assign([a2], ''); assert.equal(r.status, 200); assert.equal(db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a2).shoot_day, null);
  r = await assign([a2], 2); assert.equal(r.status, 200); assert.deepEqual(snapshot(), before);
  ok('Authenticated bulk day labeling updates shared photos once, supports clearing, rejects malformed/missing selections atomically, and preserves files, memberships, IDs, and orders');

  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome']) { try { await access(candidate); executablePath = candidate; break; } catch { /* alternate install */ } }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(15000); page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const eventUrl = `/g/${event.slug}`, alphaUrl = `${eventUrl}/c/alpha`, betaUrl = `${eventUrl}/c/beta`;
  await page.goto(base + eventUrl, { waitUntil: 'networkidle' });
  await countLinks(4, 1, 2);
  await expect(page.getByRole('link', { name: 'Open photo collection 1, 3 photos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open photo collection 2, 2 photos', exact: true })).toBeVisible();
  const publicHtml = await page.content();
  for (const forbidden of ['PRIVATE_CHILD_ALPHA_8472','PRIVATE_CHILD_BETA_8472','PRIVATE_ARCHIVED_8472','PRIVATE_PENDING_8472']) assert.ok(!publicHtml.includes(forbidden), 'Private organizer labels must not leak');
  await expect(page.locator(`a[href*="/c/archived"],a[href*="/c/pending-only"]`)).toHaveCount(0);
  await shot('all-days-collections');
  await dayLink(1, 1);
  await expect(page.getByRole('link', { name: 'Open photo collection 1, 1 photos from Day 1', exact: true })).toBeVisible();
  await expect(page.locator('a[href*="/c/beta"]')).toHaveCount(0);
  await expect(page.locator('a[href*="/c/alpha"] img')).toHaveAttribute('src', new RegExp(`/media/${a1}/preview`));
  await dayLink(2, 2);
  await expect(page.getByRole('link', { name: 'Open photo collection 1, 1 photos from Day 2', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open photo collection 2, 2 photos from Day 2', exact: true })).toBeVisible();
  await expect(page.locator('a[href*="/c/alpha"] img')).toHaveAttribute('src', new RegExp(`/media/${a2}/preview`));
  await expect(page.locator('a[href*="/c/alpha"]')).toHaveAttribute('href', alphaUrl + '?day=2');
  ok('Parent day counts deduplicate shared shots, exclude intake/archived/unready photos, and show matching covers and collections');

  await page.locator('a[href*="/c/alpha"]').click(); await assertVisible([a2]); await countLinks(3, 1, 1);
  await expect(page.getByRole('link', { name: '← All collections', exact: true })).toHaveAttribute('href', eventUrl + '?day=2');
  await expect(page.getByRole('link', { name: 'Open another collection, 2 photos', exact: true })).toHaveAttribute('href', betaUrl + '?day=2');
  await dayLink(null, 3); await assertVisible([a1, a2, a0]);
  await dayLink(1, 1); await assertVisible([a1]);
  await page.getByRole('button', { name: 'Favorite photo 1', exact: true }).click();
  await page.locator('article.photo-card').getByRole('checkbox', { name: 'Select', exact: true }).check();
  await dayLink(2, 1); await assertVisible([a2]);
  await expect(page.getByText('1 from other days or not yet assigned', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select shown', exact: true }).click();
  await page.getByRole('button', { name: 'Download selected', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Keep 2 moments', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download files ↓', exact: true }).click();
  const downloaded = await downloadPromise, downloadedPath = await downloaded.path(); assert.ok(downloadedPath);
  const unzip = spawnSync('python3', ['-c', 'import sys,json,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"count":len(z.namelist()),"bytes":sum(len(z.read(n)) for n in z.namelist())}))', downloadedPath], { timeout: 10000 });
  assert.equal(unzip.status, 0); assert.equal(JSON.parse(unzip.stdout).count, 2);
  const zipRequest = db.prepare('SELECT payload FROM download_tokens ORDER BY created_at DESC LIMIT 1').get();
  assert.deepEqual(JSON.parse(zipRequest.payload).photoIds.sort((a,b) => a-b), [a1,a2]);
  await page.getByRole('button', { name: 'Close Keep 2 moments', exact: true }).click();
  await dayLink(1, 1);
  await expect(page.getByRole('button', { name: 'Remove favorite photo 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article.photo-card').getByRole('checkbox', { name: 'Select', exact: true })).toBeChecked();
  ok('Favorites and multi-day selections survive day switches; an actual ZIP contains both selected days');
  await dayLink(2, 1);
  await page.getByRole('button', { name: 'Download shown photos (1)', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Keep this moment', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Available for 1 of 1 selected photos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Keep this moment', exact: true }).click();
  await page.getByRole('button', { name: 'Download all 3 photos', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Keep 3 moments', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Available for 3 of 3 selected photos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Keep 3 moments', exact: true }).click();
  ok('Download shown and Download all explicitly use filtered versus complete collection sizes');

  r = await request(`${eventUrl}/p/${a1}?day=2`, {}, false); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), alphaUrl + `?photo=${a1}`);
  await page.goto(base + `${eventUrl}/p/${a1}?day=2`, { waitUntil: 'networkidle' });
  await expect(page.getByAltText('Enlarged preview')).toHaveAttribute('src', new RegExp(`/media/${a1}/web`));
  await page.getByRole('dialog').getByRole('button', { name: /^Close / }).click();
  await page.goto(base + alphaUrl + `?day=2&photo=${a1}`, { waitUntil: 'networkidle' });
  await expect(page.getByAltText('Enlarged preview')).toHaveAttribute('src', new RegExp(`/media/${a1}/web`));
  await page.getByRole('dialog').getByRole('button', { name: /^Close / }).click();
  await page.goto(base + alphaUrl + '?day=invalid', { waitUntil: 'networkidle' }); await assertVisible([a1, a2, a0]);
  for (const hiddenId of [private1, archived2, pending2, pendingOnly]) assert.equal((await request(`${eventUrl}/p/${hiddenId}?day=2`, {}, false)).status, 404);
  await page.goto(base + betaUrl + '?day=1', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'No Day 1 photos in this collection yet.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open another collection, 1 photos', exact: true })).toHaveAttribute('href', alphaUrl + '?day=1');
  await expect(page.getByRole('button', { name: 'Download shown photos (0)', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Show all days', exact: true }).click(); await assertVisible([a2, b2]);
  db.prepare('UPDATE events SET password_hash=(SELECT password_hash FROM admin_users LIMIT 1) WHERE id=?').run(eventId);
  const locked = await (await request(eventUrl + '?day=2', {}, false)).text();
  assert.ok(!locked.includes('aria-label="Picture day"')); assert.ok(!locked.includes('/c/alpha'));
  db.prepare('UPDATE events SET password_hash=NULL WHERE id=?').run(eventId);
  ok('Permanent links ignore day filters; hidden shots stay inaccessible; empty-day and password-locked pages expose no misleading photos/counts');
  await page.goto(base + alphaUrl + '?day=2', { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Collection must not horizontally overflow at 390px');
  await shot('390px-day2-collection');
  await page.goto(base + eventUrl + '?day=1', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Event filter must not horizontally overflow at 390px');
  await shot('390px-day1-collections');
  ok('Parent day filters, photos, and download controls fit a 390px phone viewport');

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' }); adminContext.setDefaultTimeout(15000);
  const equals = cookie.indexOf('=');
  await adminContext.addCookies([{ name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: base, httpOnly: true, sameSite: 'Lax' }]);
  adminPage = await adminContext.newPage(); adminPage.on('pageerror', error => pageErrors.push(error.message)); adminPage.on('dialog', dialog => dialog.accept());
  await adminPage.goto(base + eventPath, { waitUntil: 'networkidle' });
  await adminPage.getByText('Filter by picture day or shooting date', { exact: true }).click();
  const dateSelect = adminPage.getByLabel('Shooting date', { exact: true });
  await expect(dateSelect).toBeEnabled();
  await dateSelect.selectOption('2026-09-24');
  await expect(adminPage.getByRole('button', { name: 'Select shown (2)', exact: true })).toBeVisible();
  await adminPage.getByRole('group', { name: 'Filter by picture day', exact: true }).getByRole('button', { name: /^Not labeled/ }).click();
  await expect(adminPage.getByRole('button', { name: 'Select shown (1)', exact: true })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Select shown (1)', exact: true }).click();
  await dateSelect.selectOption('2026-09-25');
  await expect(adminPage.getByRole('status').filter({ hasText: '1 selected photo is hidden by the current filters' })).toBeVisible();
  await dateSelect.selectOption('2026-09-24');
  ok('Owner shooting-date and unlabeled filters isolate an existing batch, with a warning when selected photos become hidden');
  await adminPage.getByText('Label picture day (optional)', { exact: true }).click();
  await adminPage.getByLabel('Picture day', { exact: true }).selectOption('2');
  await adminPage.getByRole('button', { name: 'Set day label', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a0).shoot_day).toBe(2);
  await expect(adminPage.getByRole('button', { name: 'Organize 1 photo', exact: true })).toBeVisible();
  await adminPage.getByRole('group', { name: 'Filter by picture day', exact: true }).getByRole('button', { name: /^Day 2/ }).click();
  await adminPage.getByRole('button', { name: 'Select shown (1)', exact: true }).click();
  // Rejected requests must retain the selection so the owner can correct/retry it.
  await adminPage.route('**/*?/setShootDay', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ type: 'failure', status: 400, data: '[{"error":1},"Synthetic retryable rejection"]' }) }));
  await adminPage.getByRole('button', { name: 'Set day label', exact: true }).click();
  await expect(adminPage.getByText('Synthetic retryable rejection', { exact: true })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: 'Set day label', exact: true })).toBeVisible();
  await adminPage.unroute('**/*?/setShootDay');
  await adminPage.getByLabel('Picture day', { exact: true }).selectOption('');
  await adminPage.getByRole('button', { name: 'Set day label', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT shoot_day FROM photos WHERE id=?').get(a0).shoot_day).toBe(null);
  await expect(adminPage.getByRole('button', { name: 'Organize 1 photo', exact: true })).toBeVisible();
  assert.deepEqual(snapshot(), before);
  ok('Owner bulk label/clear preserves files and orders, retains selections on both successful and failed requests');

  await adminPage.goto(base + eventPath + '/upload', { waitUntil: 'networkidle' });
  const daySelect = adminPage.getByLabel('Day for new photos', { exact: true });
  await daySelect.selectOption('2');
  const exported = path.join(scratch, 'BROWSER_DAY2.jpg'), retryFile = path.join(scratch, 'BROWSER_RETRY.jpg');
  await Promise.all([writeFile(exported, full), writeFile(retryFile, full)]);
  const uploadRoute = '**/admin/api/events/*/upload?**';
  await adminPage.route(uploadRoute, route => new URL(route.request().url()).searchParams.get('filename') === 'BROWSER_RETRY.jpg'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic interrupted upload' }) }) : route.continue());
  await adminPage.getByLabel('Choose full resolution files', { exact: true }).setInputFiles([exported, retryFile]);
  await expect(adminPage.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled();
  await adminPage.getByRole('button', { name: 'Upload files', exact: true }).click();
  await expect(adminPage.getByText(/^1 transferred · 1 need attention$/)).toBeVisible({ timeout: 30000 });
  await expect(daySelect).toBeDisabled();
  await expect(adminPage.getByRole('button', { name: 'Retry unfinished files', exact: true })).toBeEnabled();
  const browserPhoto = db.prepare("SELECT id,shoot_day FROM photos WHERE stem='browser_day2'").get(); assert.equal(browserPhoto.shoot_day, 2);
  await adminPage.reload({ waitUntil: 'networkidle' }); await expect(daySelect).toHaveValue('2'); await expect(daySelect).toBeDisabled();
  await adminPage.unroute(uploadRoute);
  await adminPage.getByLabel('Choose full resolution files', { exact: true }).setInputFiles([exported, retryFile]);
  await adminPage.getByRole('button', { name: 'Upload files', exact: true }).click();
  await expect(adminPage.getByText('2 transferred', { exact: true })).toBeVisible({ timeout: 30000 });
  assert.deepEqual(db.prepare("SELECT shoot_day FROM photos WHERE stem LIKE 'browser_%' ORDER BY id").all(), [{ shoot_day: 2 }, { shoot_day: 2 }]);
  ok('Browser upload assigns and locks the chosen day; interrupted-batch reload and retry preserve day labels');

  await adminPage.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const shotFiles = ['SHOT-10.jpg', 'SHOT-2.jpg', 'SHOT-009.jpg'].map(name => path.join(scratch, name));
  await Promise.all(shotFiles.map(file => writeFile(file, full)));
  await adminPage.getByLabel('Choose full resolution files', { exact: true }).setInputFiles(shotFiles);
  await expect(adminPage.locator('tbody tr td:first-child strong')).toHaveText(['SHOT-2', 'SHOT-009', 'SHOT-10']);
  await shot('upload-shot-order', adminPage);
  await adminPage.getByRole('button', { name: 'Upload files', exact: true }).click();
  await expect(adminPage.getByText('3 transferred', { exact: true })).toBeVisible({ timeout: 30000 });
  const shots = db.prepare("SELECT * FROM photos WHERE stem LIKE 'shot-%' ORDER BY id").all();
  await waitReady(shots.map(p => p.id));
  const shot2 = shots.find(p => p.stem === 'shot-2').id, shot9 = shots.find(p => p.stem === 'shot-009').id;
  await adminPage.goto(base + eventPath, { waitUntil: 'networkidle' });
  await adminPage.getByLabel('Find by filename, private label, or Lightroom keyword').fill('shot-');
  const photoButtons = adminPage.locator('article button[aria-pressed]');
  await expect.poll(() => photoButtons.evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))).toEqual(['Select shot-2', 'Select shot-009', 'Select shot-10']);
  await adminPage.getByRole('button', { name: 'Select shot-2', exact: true }).click();
  await adminPage.getByLabel('Photo order', { exact: true }).selectOption('desc');
  await expect.poll(() => photoButtons.evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))).toEqual(['Select shot-10', 'Select shot-009', 'Deselect shot-2']);
  await adminPage.getByLabel('Photo order', { exact: true }).selectOption('asc');
  await adminPage.reload({ waitUntil: 'networkidle' });
  await expect(adminPage.getByLabel('Photo order', { exact: true })).toHaveValue('asc');
  await adminPage.getByLabel('Find by filename, private label, or Lightroom keyword').fill('shot-');
  await expect.poll(() => photoButtons.evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))).toEqual(['Select shot-2', 'Select shot-009', 'Select shot-10']);
  ok('Upload review and organizer use numeric filename order; reverse order preserves selection and reload stays lowest-first');

  // Rehearse the owner's exact problem: solo + shared photos, one focused batch.
  await adminPage.goto(base + eventPath + '?g=' + intake, { waitUntil: 'networkidle' });
  await adminPage.getByLabel('Find by filename, private label, or Lightroom keyword').fill('shot-');
  await adminPage.getByRole('button', { name: 'Select shot-2', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Select shot-009', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Organize 2 photos', exact: true }).click();
  const sorting = adminPage.getByRole('dialog', { name: 'Organize photos', exact: true });
  await expect(sorting).toBeVisible();
  await expect(sorting.locator('article')).toHaveCount(2);
  await expect(sorting.getByRole('button', { name: 'Save & finish', exact: true })).toBeDisabled();
  await sorting.getByRole('checkbox', { name: 'Assign PRIVATE_CHILD_ALPHA_8472', exact: true }).check();
  await expect(sorting.locator(`[data-photo-id="${shot2}"]`)).toContainText('PRIVATE_CHILD_ALPHA_8472 · to add');
  await sorting.getByRole('button', { name: 'Select none in batch', exact: true }).click();
  await sorting.getByRole('button', { name: 'Select batch photo shot-009', exact: true }).click();
  await sorting.getByRole('button', { name: '+ Create & assign selected', exact: true }).click();
  await expect(sorting.getByRole('checkbox', { name: 'Assign Collection 001', exact: true })).toBeChecked();
  await sorting.getByRole('checkbox', { name: 'Assign PRIVATE_CHILD_BETA_8472', exact: true }).check();
  await expect(sorting.locator(`[data-photo-id="${shot9}"]`)).toContainText('Collection 001 · to add');
  await expect(sorting.locator(`[data-photo-id="${shot2}"]`)).not.toContainText('Collection 001');
  assert.equal(db.prepare("SELECT count(*) n FROM galleries WHERE name='Collection 001'").get().n, 0, 'Draft does not create live collections');
  const initialMemberships = db.prepare('SELECT * FROM gallery_photos ORDER BY gallery_id,photo_id').all();
  await shot('desktop-focused-sorting', adminPage);
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await sorting.getByRole('button', { name: 'Choose collections ↑', exact: true }).click();
  assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await sorting.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await shot('390px-focused-sorting-collections', adminPage);
  await sorting.getByRole('button', { name: 'Choose a different subset of photos ↓', exact: true }).click();
  await shot('390px-focused-sorting-photos', adminPage);
  ok('Focused batch shows only chosen photos, assigns all to the first child and just shared shots to more children, with inline unnamed collection and per-photo badges');

  const organizeUrl = `/admin/api/events/${eventId}/organize`;
  const samplePlan = { targets: [{ kind: 'existing', galleryId: alpha, photoIds: [shot2] }] };
  r = await request(organizeUrl, { method: 'POST', body: JSON.stringify(samplePlan), headers: { 'content-type': 'application/json' } }, false); assert.equal(r.status, 401);
  r = await request(organizeUrl, { method: 'POST', body: JSON.stringify(samplePlan), headers: { 'content-type': 'application/json', origin: 'https://foreign.invalid' } }); assert.equal(r.status, 403);
  r = await request(organizeUrl, { method: 'POST', body: JSON.stringify({targets:[{...samplePlan.targets[0],galleryId:foreignGallery}]}), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400);
  assert.deepEqual(db.prepare('SELECT * FROM gallery_photos ORDER BY gallery_id,photo_id').all(), initialMemberships);
  ok('Focused sorting API rejects anonymous, cross-origin and foreign-event writes before changing memberships');
  await adminPage.route('**/admin/api/events/*/organize', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic grouping failure' }) }));
  await sorting.getByRole('button', { name: 'Save & finish', exact: true }).click();
  await expect(sorting.getByRole('alert')).toHaveText('Synthetic grouping failure');
  await expect(sorting.getByRole('checkbox', { name: 'Assign Collection 001', exact: true })).toBeChecked();
  assert.deepEqual(db.prepare('SELECT * FROM gallery_photos ORDER BY gallery_id,photo_id').all(), initialMemberships);
  await adminPage.unroute('**/admin/api/events/*/organize');
  const unchangedShots = db.prepare("SELECT * FROM photos WHERE stem LIKE 'shot-%' ORDER BY id").all();
  const unchangedFiles = db.prepare('SELECT * FROM photo_files ORDER BY id').all();
  const unchangedOrders = db.prepare('SELECT * FROM order_item_cells ORDER BY id').all();
  // Simulate a saved request whose response is lost. The same plan must retry safely.
  await adminPage.route('**/admin/api/events/*/organize', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic lost response after save' }) });
  });
  await sorting.getByRole('button', { name: 'Save & finish', exact: true }).click();
  await expect(sorting.getByRole('alert')).toHaveText('Synthetic lost response after save');
  const kid = db.prepare("SELECT id FROM galleries WHERE event_id=? AND name='Collection 001'").get(eventId).id;
  const memberships = () => db.prepare('SELECT gallery_id,photo_id FROM gallery_photos WHERE photo_id IN (?,?) ORDER BY photo_id,gallery_id').all(shot2, shot9);
  const expectedMemberships = [ {photo_id:shot2,gallery_id:alpha}, ...[alpha,beta,kid].map(gallery_id=>({photo_id:shot9,gallery_id})) ].sort((a,b)=>a.photo_id-b.photo_id||a.gallery_id-b.gallery_id);
  assert.deepEqual(memberships(), expectedMemberships);
  await adminPage.unroute('**/admin/api/events/*/organize');
  await sorting.getByRole('button', { name: 'Save & finish', exact: true }).click();
  await expect(sorting).toHaveCount(0);
  await expect(adminPage.getByRole('region', { name: 'Selected photo actions', exact: true })).toHaveCount(0);
  await expect(adminPage.getByRole('button', {name:'Select shot-2',exact:true})).toHaveCount(0);
  await expect(adminPage.getByRole('button', {name:'Select shot-009',exact:true})).toHaveCount(0);
  await expect(adminPage.getByRole('button', {name:'Select shot-10',exact:true})).toBeVisible();
  assert.equal(db.prepare("SELECT count(*) n FROM galleries WHERE event_id=? AND name='Collection 001'").get(eventId).n, 1);
  assert.deepEqual(memberships(), expectedMemberships);
  assert.deepEqual(db.prepare("SELECT * FROM photos WHERE stem LIKE 'shot-%' ORDER BY id").all(), unchangedShots);
  assert.deepEqual(db.prepare('SELECT * FROM photo_files ORDER BY id').all(), unchangedFiles);
  assert.deepEqual(db.prepare('SELECT * FROM order_item_cells ORDER BY id').all(), unchangedOrders);
  ok('Save failure keeps draft; a lost successful response retries without duplicate collections; filed photos leave To sort while untouched photos, originals and order references stay intact');

  await adminPage.getByRole('button', {name:'Select shot-10',exact:true}).click();
  await adminPage.getByRole('button', {name:'Organize 1 photo',exact:true}).click();
  await sorting.getByRole('button', { name: '+ Create & assign selected', exact: true }).click();
  await expect(sorting.getByRole('checkbox',{name:'Assign Collection 002',exact:true})).toBeChecked();
  await sorting.getByRole('button',{name:'Close sorting window',exact:true}).click();
  await expect(sorting).toHaveCount(0);
  await expect(adminPage.getByRole('button',{name:'Organize 1 photo',exact:true})).toBeVisible();
  assert.equal(db.prepare("SELECT count(*) n FROM galleries WHERE name='Collection 002'").get().n,0);
  ok('Cancel discards unsaved new collections and preserves the original grid selection');
  await page.goto(base + alphaUrl, { waitUntil: 'networkidle' }); await assertVisible([a1,a2,a0,shot2,shot9]);
  await page.goto(base + betaUrl, { waitUntil: 'networkidle' }); await assertVisible([a2,b2,shot9]);
  ok('Parents see exactly the appropriate solo/shared photos in each collection');
  assert.deepEqual(pageErrors, []); ok('No browser JavaScript exceptions during parent filtering, selection, downloads, or owner labeling/import');
  console.log(JSON.stringify({ passed: checks.length, checks, screenshots }, null, 2));
} catch (error) {
  if (page && artifactDir) await shot('failure').catch(() => {});
  if (adminPage && artifactDir) await shot('admin-failure', adminPage).catch(() => {});
  console.error('Shoot-day rehearsal failed:', error); console.error('Disposable fixture logs:\n' + logs); throw error;
} finally {
  await browser?.close(); db?.close(); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); clearTimeout(timer);
  await rm(scratch, { recursive: true, force: true });
}
