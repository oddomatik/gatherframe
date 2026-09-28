// Boots the actual Compose definition with a uniquely named disposable volume.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
const image = process.argv[2];
if (!image || !/^[a-zA-Z0-9./:@_-]+$/.test(image)) throw Error('Pass an already-built local image tag/digest');
const dir = await mkdtemp(path.join(tmpdir(), 'picture-day-compose-'));
const project = 'pd-test-' + randomBytes(6).toString('hex');
const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const privateEnv = path.join(dir, 'test.env');
await writeFile(privateEnv, `APP_SECRET=${randomBytes(32).toString('hex')}\nPUBLIC_ORIGIN=${base}\nPORT=${port}\nBIND_ADDRESS=127.0.0.1\nGATHERFRAME_IMAGE=${image}\nSETUP_ENABLED=0\n`, { mode: 0o600 });
const args = ['compose', '--project-name', project, '--env-file', privateEnv, '-f', path.resolve('docker-compose.yml')];
// Do not inherit another instance's Compose or application settings from the shell.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH','HOME','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','XDG_RUNTIME_DIR'].includes(key)));
const compose = (...rest) => execFileSync('docker', [...args, ...rest], { encoding: 'utf8', env: cleanEnv, timeout: 120000 });
const req = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options });
async function ready() {
  for (let i = 0; i < 150; i++) {
    try { if ((await req('/healthz')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Container health timed out');
}
try {
  compose('up', '-d', '--no-build', 'app'); await ready();
  assert.equal((await req('/setup')).status, 404);
  assert.equal((await req('/admin/login')).status, 200);
  assert.equal(compose('exec', '-T', 'app', 'id', '-u').trim(), '1000');
  assert.equal((await req('/about')).status, 200);
  const source = await req('/source.tgz'); assert.equal(source.status, 200);
  const archive = path.join(dir, 'source.tgz'); await writeFile(archive, Buffer.from(await source.arrayBuffer()));
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
  assert.ok(listing.includes('LICENSE') && listing.includes('src/routes/setup/+page.server.ts'));
  assert.ok(!listing.some(name => /^(data\/|\.git\/|backups\/|\.env$)/.test(name)));
  // Enable private setup only for this loopback-only synthetic instance.
  const { readFile } = await import('node:fs/promises');
  const config = await readFile(privateEnv, 'utf8');
  await writeFile(privateEnv, config.replace('SETUP_ENABLED=0', 'SETUP_ENABLED=1'), { mode: 0o600 });
  compose('up', '-d', '--no-build', '--force-recreate', 'app'); await ready();
  const setup = await req('/setup', { method: 'POST', headers: { origin: base, accept: 'text/html' }, body: new URLSearchParams({ email: 'container@example.invalid', password: randomBytes(24).toString('hex'), studioName: 'Compose fixture' }) });
  assert.equal(setup.status, 303); const cookie = setup.headers.get('set-cookie').split(';')[0];
  await writeFile(privateEnv, config, { mode: 0o600 });
  compose('up', '-d', '--no-build', '--force-recreate', 'app'); await ready();
  assert.equal((await req('/setup')).status, 404);
  assert.equal((await req('/admin', { headers: { cookie } })).status, 200);
  compose('exec', '-T', 'app', 'node', 'scripts/snapshot-db.mjs', '/data/backups/smoke.sqlite');
  console.log('PASS Compose: non-root writable volume, private setup, persistent login, source archive and database snapshot');
} catch (error) {
  console.error(compose('logs', '--tail=40', 'app')); throw error;
} finally {
  // Only the unique disposable test project is removed, including its test volume.
  compose('down', '--volumes', '--remove-orphans'); await rm(dir, { recursive: true, force: true });
}
