// Fresh production-build setup, persistence, backup/restore and downgrade safety.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-self-host-'));
const data = path.join(scratch, 'data');
const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: base, ORIGIN: base,
  APP_SECRET: randomBytes(32).toString('hex'), DATA_DIR: data, SETUP_ENABLED: '0', B2_KEY_ID: '', B2_APPLICATION_KEY: '' };
let child, logs = '';
async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; } child = null; }
async function boot(overrides = {}) {
  logs = ''; child = spawn(process.execPath, ['server.js'], { env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + b).slice(-12000); });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw Error(logs);
    try { if ((await fetch(base + '/healthz')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Server never became healthy: ' + logs);
}
const req = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options });
try {
  const invalid = spawnSync(process.execPath, ['server.js'], { env: { ...env, APP_SECRET: '' }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /APP_SECRET/);
  await boot({ SETUP_ENABLED: undefined });
  assert.equal((await req('/setup')).status, 404);
  const pending = await req('/admin/login'); assert.equal(pending.status, 200); assert.match(await pending.text(), /being set up/);
  assert.equal((await req('/admin/api/events/1/upload', { method: 'PUT' })).status, 401);
  console.log('PASS fresh instance is unclaimable until setup is explicitly enabled');
  const doctor = (overrides = {}) => {
    const result = spawnSync(process.execPath, ['scripts/doctor.mjs','--json'], { env:{...env,...overrides}, encoding:'utf8', timeout:20000 });
    assert.equal(result.status,0,result.stderr || result.stdout);
    const report=JSON.parse(result.stdout);assert.equal(report.ok,true);return report;
  };
  const initialReport=doctor();assert.equal(initialReport.checks.find(c=>c.id==='owner').status,'warn');

  await stop(); await boot({ SETUP_ENABLED: '1' });
  const form = new URLSearchParams({ email: 'owner@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Self-host rehearsal' });
  assert.equal((await req('/setup', { method: 'POST', headers: { origin: 'https://foreign.invalid' }, body: form })).status, 403);
  const setup = await req('/setup', { method: 'POST', headers: { origin: base, accept: 'text/html' }, body: form });
  assert.equal(setup.status, 303); const cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await req('/admin', { headers: { cookie } })).status, 200);
  const enabledReport=doctor({SETUP_ENABLED:'1'});assert.equal(enabledReport.checks.find(c=>c.id==='setup-setting').status,'warn');
  await stop(); await boot();
  assert.equal((await req('/setup')).status, 404);
  assert.equal((await req('/admin', { headers: { cookie } })).status, 200);
  console.log('PASS private setup, cross-origin refusal and session persistence across restart');
  const report=doctor();assert.equal(report.checks.find(c=>c.id==='owner').status,'pass');assert.equal(report.checks.find(c=>c.id==='setup-setting').status,'pass');
  console.log('PASS read-only doctor covers fresh/private/completed owner setup with real HTTP checks');
  const backup = path.join(scratch, 'snapshot.sqlite');
  const snapshot = spawnSync(process.execPath, ['scripts/snapshot-db.mjs', backup], { env, encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  await stop();
  const restoredDir = path.join(scratch, 'restored'); await mkdir(path.join(restoredDir, 'db'), { recursive: true });
  await copyFile(backup, path.join(restoredDir, 'db/app.sqlite'));
  await boot({ DATA_DIR: restoredDir });
  assert.equal((await req('/admin', { headers: { cookie } })).status, 200);
  await stop();
  console.log('PASS consistent backup boots in a separate data directory with owner session retained');
  const db = new Database(path.join(restoredDir, 'db/app.sqlite'));
  db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run('9999_future_release', new Date().toISOString()); db.close();
  const future = spawnSync(process.execPath, ['server.js'], { env: { ...env, DATA_DIR: restoredDir }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(future.status, 0); assert.match(future.stderr, /unsafe downgrade/);
  console.log('PASS older code refuses a database with unknown migrations');
} finally { await stop(); await rm(scratch, { recursive: true, force: true }); }
