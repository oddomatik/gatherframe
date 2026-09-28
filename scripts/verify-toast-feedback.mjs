// Real enhanced-form actions against a disposable production-build instance.
// EXPECT_TOAST_LOOP=1 reproduces the old bug before rebuilding with the fix.
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-toast-'));
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
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/healthz')).ok) break; } catch {}
    if (i === 99 || child.exitCode !== null) throw Error(logs);
    await delay(100);
  }
  let r = await request('/setup', { email: 'toast@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Toast fixture' });
  assert.equal(r.status, 303); cookie = r.headers.get('set-cookie').split(';')[0];
  r = await request('/admin?/create', { name: 'Toast fixture' });
  const eventPath = r.headers.get('location'), eventId = Number(eventPath.split('/').at(-1));
  db = new Database(path.join(dataDir, 'db/app.sqlite')); db.pragma('foreign_keys=ON');
  const stamp = new Date().toISOString();
  const orderId = db.prepare(`INSERT INTO orders(order_number,access_token,idempotency_key,event_id,customer_name,subtotal_cents,total_cents,currency,created_at,updated_at)
    VALUES('TOAST-FIXTURE','toast-fixture','toast-fixture',?,'Synthetic parent',1000,1000,'USD',?,?)`).run(eventId, stamp, stamp).lastInsertRowid;
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome']) {
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-write'] });
  await context.addCookies([{ name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') requests.push(request.url()); });
  const notices = page.locator('[aria-live="polite"] > div');
  async function resetObserver() {
    await page.evaluate(() => {
      window.toastObserver?.disconnect(); window.toastStats = { peak: 0, messages: [] };
      const root = document.querySelector('[aria-live="polite"]');
      window.toastObserver = new MutationObserver(records => {
        window.toastStats.peak = Math.max(window.toastStats.peak, root.children.length);
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) window.toastStats.messages.push(node.textContent);
        }
      });
      window.toastObserver.observe(root, { childList: true });
    });
  }
  async function expiresWithNoReplay(expectedMessages) {
    await expect(notices).toHaveCount(0, { timeout: 11000 });
    await page.waitForTimeout(250);
    assert.deepEqual((await page.evaluate(() => window.toastStats)).messages, expectedMessages);
    assert.deepEqual(errors, []);
  }
  await page.goto(base + '/admin/settings', { waitUntil: 'networkidle' });
  await resetObserver();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  if (process.env.EXPECT_TOAST_LOOP === '1') {
    await page.waitForTimeout(500);
    const stats = await page.evaluate(() => window.toastStats);
    assert.ok(stats.messages.length > 1 || errors.some(error => error.includes('effect_update_depth_exceeded')));
    assert.equal(requests.length, 1, 'Only one save request should cause the notification storm');
    console.log(JSON.stringify({ reproduced: true, oneSaveRequest: true, messages: stats.messages.length, peak: stats.peak, errors }));
  } else {
    await expect(notices).toHaveText(['Settings saved']);
    await expiresWithNoReplay(['Settings saved']);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(notices).toHaveText(['Settings saved']);
    await expiresWithNoReplay(['Settings saved', 'Settings saved']);
    assert.equal(requests.length, 2);
    ok('Settings: one confirmation per save; expiration does not regenerate it; a later identical save still confirms');

    await page.goto(base + '/admin/catalog', { waitUntil: 'networkidle' });
    await resetObserver();
    const product = page.locator('form[action="?/save"]').first();
    await product.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notices).toHaveText(['Saved']);
    await product.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notices).toHaveText(['Saved', 'Saved']);
    await expiresWithNoReplay(['Saved', 'Saved']);
    await product.locator('[name="price"]').fill('not-a-price');
    await product.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notices).toHaveCount(1);
    const errorText = await notices.innerText();
    await expiresWithNoReplay(['Saved', 'Saved', errorText]);
    ok('Catalog: successive saves remain distinct; validation errors appear once and expire');

    await page.goto(`${base}/admin/orders/${orderId}`, { waitUntil: 'networkidle' });
    await resetObserver();
    await page.locator('[name="adminNotes"]').fill('Fixture note');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(notices).toHaveText(['Notes saved']);
    await page.getByRole('button', { name: 'Copy parent link', exact: true }).click();
    await expect(notices).toHaveText(['Notes saved', 'Copied']);
    await expiresWithNoReplay(['Notes saved', 'Copied']);
    assert.equal(db.prepare('SELECT admin_notes FROM orders WHERE id=?').get(orderId).admin_notes, 'Fixture note');
    assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 0);
    ok('Order: unrelated copy notification cannot replay a saved confirmation; notes persist, no payment writes');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(notices).toHaveText(['Contact updated']);
    const box = await notices.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height < 844 && box.x >= 0 && box.x + box.width <= 390);
    await expiresWithNoReplay(['Notes saved', 'Copied', 'Contact updated']);
    ok('Mobile: one compact confirmation stays in the viewport and expires normally');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: checks.length, checks, requests: requests.length, browserErrors: errors }));
  }
} catch (error) { console.error(logs); throw error; }
finally {
  await browser?.close(); db?.close(); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  clearTimeout(timer); await rm(scratch, { recursive: true, force: true });
}
