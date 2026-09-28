// Production-build HTTP rehearsal against disposable data only. Never uses a live account.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(path.join(tmpdir(), 'picture-day-sidecars-http-'));
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = ''; child.stdout.on('data', b => { logs = (logs + b).slice(-12000); }); child.stderr.on('data', b => { logs = (logs + b).slice(-12000); });
let cookie = '', db;
const checks = [];
async function request(url, options = {}, authenticated = true) {
  return fetch(base + url, { redirect: 'manual', ...options,
    headers: { accept: 'text/html', ...(authenticated && cookie ? { cookie } : {}), origin: base, ...options.headers } });
}
function ok(name) { checks.push(name); }
const form = body => ({ method: 'POST', body: new URLSearchParams(body) });
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/healthz')).ok) break; } catch { /* server boot */ }
    if (i === 99 || child.exitCode !== null) throw new Error('Fixture server failed to start: ' + logs);
    await new Promise(r => setTimeout(r, 100));
  }
  let r = await request('/setup', form({ email: 'sidecar-fixture@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Sidecar fixture' }));
  assert.equal(r.status, 303); cookie = r.headers.get('set-cookie').split(';')[0];
  r = await request('/admin?/create', form({ name: 'Sidecar rehearsal' })); assert.equal(r.status, 303);
  const eventPath = r.headers.get('location'), eventId = Number(eventPath.split('/').at(-1));
  assert.ok(eventId); assert.equal((await request(eventPath + '/upload')).status, 200);
  db = new Database(path.join(dataDir, 'db/app.sqlite'));
  const intake = db.prepare('select id from galleries where event_id=? and is_intake=1').get(eventId).id;
  const upload = (filename, body, replacement = 'reject', role = 'raw') => request(`/admin/api/events/${eventId}/upload?` + new URLSearchParams({ gallery: String(intake), filename, role, replacement }), { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream' } });
  const xmp = Buffer.from(`<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="4"><dc:subject><rdf:Bag><rdf:li>PRIVATE_XMP_KEYWORD_8472</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`);
  r = await upload('IMG_0042.xmp', xmp); assert.equal(r.status, 200, r.status !== 200 ? await r.text() : undefined); const first = await r.json();
  assert.equal(first.role, 'xmp'); const photoId = first.photoId;
  assert.equal(db.prepare('select count(*) n from photo_files').get().n, 0);
  assert.equal(db.prepare('select rendition_status s from photos where id=?').get(photoId).s, 'nosource'); ok('Sidecar-first upload is private, pending, and separate from image variants');
  const raw = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc9955' } }).tiff().toBuffer();
  r = await upload('IMG_0042.dng', raw); assert.equal(r.status, 200); assert.equal((await r.json()).photoId, photoId);
  const jpeg = await sharp(raw).jpeg().toBuffer(); r = await upload('IMG_0042.jpg', jpeg, 'reject', 'print');
  assert.equal(r.status, 200); assert.equal((await r.json()).photoId, photoId); ok('RAW and finished JPEG attach to the same photo');
  r = await upload('IMG_0042.xmp', xmp); assert.equal((await r.json()).status, 'unchanged');
  const newer = Buffer.from(xmp.toString().replace('Rating="4"', 'Rating="5"'));
  assert.equal((await upload('IMG_0042.xmp', newer)).status, 409);
  r = await upload('IMG_0042.xmp', newer, 'replace'); assert.equal((await r.json()).status, 'replaced'); ok('Identical retry and explicit sidecar replacement');
  const acr = Buffer.from('synthetic opaque ACR companion'); r = await upload('IMG_0042.acr', acr); assert.equal(r.status, 200); ok('ACR is retained as an opaque private companion');
  const inventory = await (await request(`/admin/api/events/${eventId}/photos?import=1`)).json();
  assert.deepEqual(inventory.photos[0].sidecars.map(s => s.kind).sort(), ['acr', 'xmp']);
  const organizer = await (await request(eventPath)).text(); assert.match(organizer, /PRIVATE_XMP_KEYWORD_8472/); assert.match(organizer, /Lightroom/);
  const importer = await (await request(eventPath + '/upload')).text(); assert.match(importer, /XMP/); ok('Authenticated inventory, upload and organizer render sidecar controls');
  r = await request(`/admin/api/photos/${photoId}/source-archive`, {}, false); assert.equal(r.status, 401);
  r = await request(`/admin/api/photos/${photoId}/source-archive`); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-store/);
  const zip = Buffer.from(await r.arrayBuffer());
  const unpack = spawnSync('python3', ['-c', 'import sys,io,zipfile,json,base64; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))'], { input: zip });
  assert.equal(unpack.status, 0); const entries = JSON.parse(unpack.stdout);
  for (const [ext, expected] of [['dng', raw], ['xmp', newer], ['acr', acr]]) {
    const entry = Object.keys(entries).find(n => n.endsWith('IMG_0042.' + ext)); assert.ok(entry, ext + ' paired archive name');
    assert.deepEqual(Buffer.from(entries[entry], 'base64'), expected);
  }
  ok('Owner archive requires login and contains byte-exact RAW/XMP/ACR with paired names');
  // Publish only synthetic fixture data for the anonymous privacy check.
  db.prepare('update galleries set is_intake=0 where id=?').run(intake);
  db.prepare('update events set is_published=1 where id=?').run(eventId);
  const slug = db.prepare('select slug from events where id=?').get(eventId).slug;
  const parent = await (await request(`/g/${slug}`, {}, false)).text();
  assert.ok(!parent.includes('PRIVATE_XMP_KEYWORD_8472')); assert.ok(!parent.includes('photo_sidecars')); ok('Private XMP keyword absent from parent response');
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  db?.close(); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); clearTimeout(timer);
  await rm(dataDir, { recursive: true, force: true });
}
