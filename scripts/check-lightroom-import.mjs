/** Real HTTP regression against a fresh, disposable production-build server. No owner data. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import sharp from 'sharp';
import { request } from '@playwright/test';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dataDir = await mkdtemp(path.join(tmpdir(), 'picture-day-import-http-'));
const reservation = createServer();
reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const baseURL = `http://127.0.0.1:${port}`;
let logs = '';
const server = spawn(process.execPath, ['server.js'], { cwd, env: {
  ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'),
  HOST: '127.0.0.1', PORT: String(port), ORIGIN: baseURL, PUBLIC_ORIGIN: baseURL, SETUP_ENABLED: '1',
  HOST_HEADER: '', PROTOCOL_HEADER: '', MAX_UPLOAD_BYTES: '1000000',
  B2_ENDPOINT: '', B2_REGION: '', B2_BUCKET: '', B2_KEY_ID: '', B2_APPLICATION_KEY: ''
}, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });
server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });
const contexts = [];
async function client() {
  const c = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, accept: 'text/html' }, timeout: 10000 });
  contexts.push(c); return c;
}
const passed = [];
async function check(name, run) { await run(); passed.push(name); console.log(`PASS ${name}`); }
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited: ${logs}`);
    try { const response = await fetch(`${baseURL}/setup`); if (response.status === 200) break; } catch { /* starting */ }
    if (attempt > 80) throw new Error(`Fixture server did not become ready: ${logs}`);
    await delay(100);
  }
  const owner = await client(), guest = await client();
  const setup = await owner.post('/setup', { form: { email: 'fixture@example.test', password: randomBytes(20).toString('hex'), studioName: 'Synthetic Lightroom test' }, maxRedirects: 0 });
  assert.equal(setup.status(), 303);
  const create = await owner.post('/admin?/create', { form: { name: 'Synthetic Lightroom import' }, maxRedirects: 0 });
  assert.equal(create.status(), 303);
  const eventId = Number(create.headers().location.split('/').at(-1)); assert.ok(eventId);
  const api = `/admin/api/events/${eventId}`;
  async function collection(body) { const r = await owner.post(`${api}/collections`, { data: body }); assert.equal(r.status(), 200); return (await r.json()).gallery; }
  const intake = await collection({ intake: true }), child = await collection({ label: 'Child A' }), friend = await collection({ label: 'Friend B' });
  const jpeg = (color) => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer();
  const fullA = await jpeg('#ff8800'), fullB = await jpeg('#0099cc'), socialA = await jpeg('#ffaa33'), editedA = await jpeg('#ff5500');
  async function upload(filename, role, bytes, extra = {}) {
    const query = new URLSearchParams({ filename, role, gallery: String(intake.id), ...extra });
    const r = await owner.put(`${api}/upload?${query}`, { data: bytes, headers: { 'content-type': 'application/octet-stream' } });
    return { status: r.status(), body: await r.json() };
  }
  async function inventory() { const r = await owner.get(`${api}/photos?import=1`); assert.equal(r.status(), 200); return (await r.json()).photos; }
  const members = (photo) => photo.collections.map((g) => g.id).sort((a, b) => a - b);
  let photoId;
  await check('import inventory stays authenticated and rejects cross-origin upload', async () => {
    assert.equal((await guest.get(`${api}/photos?import=1`)).status(), 401);
    assert.equal((await owner.get('/admin/api/events/999999/photos?import=1')).status(), 404);
    assert.equal((await owner.put(`${api}/upload?filename=blocked.jpg&role=print&gallery=${intake.id}`, { data: fullA, headers: { origin: 'https://unrelated.invalid' } })).status(), 403);
    assert.equal((await inventory()).length, 0);
  });
  await check('unequal role sets become two photos, not three', async () => {
    const a = await upload('IMG_0412.jpg', 'print', fullA); assert.equal(a.status, 200); photoId = a.body.photoId;
    assert.equal((await upload('IMG_0413.jpg', 'print', fullB)).status, 200);
    const social = await upload('IMG_0412.jpg', 'social', socialA); assert.equal(social.status, 200); assert.equal(social.body.photoId, photoId);
    const photos = await inventory(); assert.equal(photos.length, 2);
    assert.deepEqual(photos.find((p) => p.id === photoId).files.map((f) => f.role).sort(), ['print', 'social']);
    assert.deepEqual(photos.find((p) => p.id !== photoId).files.map((f) => f.role), ['print']);
  });
  await check('sorted shared photo keeps identity and memberships on a later upload', async () => {
    for (const gallery of [child, friend]) {
      const r = await owner.post(`/admin/events/${eventId}?/organize`, { form: { photoId: String(photoId), targetId: String(gallery.id), mode: 'add' } });
      assert.equal(r.status(), 200);
    }
    const retry = await upload('IMG_0412.JPG', 'social', socialA); assert.equal(retry.status, 200); assert.equal(retry.body.status, 'unchanged'); assert.equal(retry.body.photoId, photoId);
    const photo = (await inventory()).find((p) => p.id === photoId);
    assert.deepEqual(members(photo), [child.id, friend.id]);
    assert.ok(photo.matchKeys.includes('img_0412'));
  });
  await check('changed master needs explicit update; absent versions and collections survive', async () => {
    const refused = await upload('IMG_0412.jpg', 'print', editedA); assert.equal(refused.status, 409);
    const accepted = await upload('IMG_0412.jpg', 'print', editedA, { replacement: 'replace' });
    assert.equal(accepted.status, 200); assert.equal(accepted.body.status, 'replaced'); assert.equal(accepted.body.photoId, photoId);
    const photos = await inventory(); assert.equal(photos.length, 2);
    const photo = photos.find((p) => p.id === photoId);
    assert.deepEqual(members(photo), [child.id, friend.id]);
    assert.deepEqual(photo.files.map((f) => f.role).sort(), ['print', 'social']);
    assert.equal((await upload('IMG_0412.jpg', 'print', editedA)).body.status, 'unchanged');
  });
  await check('authenticated upload page renders the simplified folder workflow', async () => {
    const r = await owner.get(`/admin/events/${eventId}/upload`); assert.equal(r.status(), 200);
    const html = await r.text();
    assert.match(html, /Full.resolution/i); assert.match(html, /Social/i); assert.match(html, /RAW/);
    assert.ok((html.match(/webkitdirectory/g) ?? []).length >= 3, 'role-specific folder pickers present');
    assert.ok(!html.includes('separate folder identities'));
  });
  await check('storage page stays private and exposes three choices without credential inputs', async () => {
    assert.equal((await guest.get('/admin/storage', { maxRedirects: 0 })).status(), 303);
    const r = await owner.get('/admin/storage'); assert.equal(r.status(), 200);
    const html = await r.text();
    assert.match(html, /Backblaze B2/); assert.match(html, /local copy/);
    assert.ok(!/name=["']?B2_(KEY_ID|APPLICATION_KEY)/.test(html));
    assert.equal((await guest.post('/admin/storage?/save', { form: { mode: 'b2' }, maxRedirects: 0 })).status(), 401);
  });
  await check('unconfigured B2 cannot be enabled and local storage remains selectable', async () => {
    assert.equal((await owner.post('/admin/storage?/test', { form: {} })).status(), 400);
    assert.equal((await owner.post('/admin/storage?/save', { form: { mode: 'b2' } })).status(), 400);
    assert.equal((await owner.post('/admin/storage?/save', { form: { mode: 'local' } })).status(), 200);
    assert.equal((await upload('IMG_0412.jpg', 'print', editedA)).body.status, 'unchanged');
  });
  console.log(JSON.stringify({ passed: passed.length, mode: 'isolated production server, HTTP + SSR only; no browser interaction', checks: passed }, null, 2));
} catch (error) {
  console.error(logs); throw error;
} finally {
  for (const context of contexts) await context.dispose();
  if (server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  await rm(dataDir, { recursive: true, force: true });
}
