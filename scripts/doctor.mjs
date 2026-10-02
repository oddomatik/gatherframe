#!/usr/bin/env node
// Read-only diagnostics for the configured instance; never imports app startup/migrations.
import { access, readFile, readdir, stat, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { validateRuntime } from './runtime-config.mjs';

export async function diagnose({ env = process.env, offline = false, fetcher = fetch, now = Date.now() } = {}) {
  const checks = [];
  const add = (id, status, summary, action = '') => checks.push({ id, status, summary, ...(action ? { action } : {}) });
  const dataDir = path.resolve(env.DATA_DIR || './data');
  let version = 'unknown';
  try { version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version; } catch {}
  try {
    validateRuntime({ ...env, NODE_ENV: 'production' });
    add('configuration', 'pass', 'Required runtime configuration is valid.');
  } catch {
    add('configuration', 'fail', 'Runtime configuration is incomplete or invalid.', 'Check APP_SECRET (durable random secret, at least 32 characters), matching PUBLIC_ORIGIN/ORIGIN without paths, and SETUP_ENABLED=0 or 1. Existing signing secrets must survive upgrades.');
  }
  try {
    for (const name of ['', 'db', 'originals', 'derivatives', 'tmp', 'backups']) {
      const dir = path.join(dataDir, name);
      if (!(await stat(dir)).isDirectory()) throw Error('not a directory');
      await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    }
    add('storage-access', 'pass', 'Required data directories are accessible to this process.');
  } catch {
    add('storage-access', 'fail', 'A required data directory is missing or inaccessible.', 'Run inside the app container. Check the existing volume identity and UID/GID 1000 permissions; do not create replacement storage to hide an empty instance.');
  }
  try {
    const disk = await statfs(dataDir, { bigint: true });
    const free = disk.bavail * disk.bsize;
    const rawFloor = env.STORAGE_MIN_FREE_BYTES ?? '268435456';
    if (!/^\d+$/.test(rawFloor)) throw Error('invalid floor');
    const floor = BigInt(rawFloor);
    add('disk-space', free >= floor ? 'pass' : 'fail', `${free / 1048576n} MiB available; configured floor ${floor / 1048576n} MiB.`, free >= floor ? '' : 'Free space before imports or ZIP generation. Media, derivatives and temporary work need additional capacity.');
  } catch {
    add('disk-space', 'fail', 'Could not check available space or its configured floor.', 'Check the data mount and STORAGE_MIN_FREE_BYTES (non-negative integer bytes).');
  }
  let owners = null;
  let db;
  try {
    db = new Database(path.join(dataDir, 'db/app.sqlite'), { readonly: true, fileMustExist: true, timeout: 3000 });
    db.pragma('query_only = ON');
    const valid = db.pragma('quick_check', { simple: true }) === 'ok' && db.pragma('foreign_key_check').length === 0;
    add('database', valid ? 'pass' : 'fail', valid ? 'SQLite integrity and foreign-key checks passed.' : 'SQLite integrity or foreign-key checks failed.', valid ? '' : 'Preserve the current volume and obtain a private recovery copy before investigating.');
    owners = db.prepare('SELECT count(*) AS count FROM admin_users').get().count;
    add('owner', owners > 0 ? 'pass' : 'warn', owners > 0 ? 'An owner account exists; identity is not printed.' : 'No owner account exists yet.', owners > 0 ? '' : 'Use private first-owner setup over loopback or an SSH tunnel, then disable SETUP_ENABLED. Do not expose setup publicly.');
  } catch {
    add('database-readable', 'fail', 'The existing application database could not be fully inspected.', 'Start the reviewed app once for a fresh installation, or verify the existing data mount. This command never creates or migrates a database.');
  } finally { db?.close(); }
  if (env.SETUP_ENABLED === '1') {
    add('setup-setting', 'warn', owners > 0 ? 'Setup is still enabled after owner creation.' : 'Private first-owner setup is enabled.', 'After owner creation, set SETUP_ENABLED=0 and recreate the app with the same volume and signing secret.');
  } else if (env.SETUP_ENABLED === undefined || env.SETUP_ENABLED === '0') {
    add('setup-setting', 'pass', 'First-owner setup is configured closed.');
  }
  try {
    const backups = path.join(dataDir, 'backups');
    const snapshots = [];
    for (const name of await readdir(backups)) {
      if (!name.endsWith('.sqlite')) continue;
      const file = await stat(path.join(backups, name));
      if (file.isFile() && file.size > 0) snapshots.push(file.mtimeMs);
    }
    const newest = snapshots.length ? Math.max(...snapshots) : null;
    add('recovery', 'warn', newest === null ? 'No nonempty local database snapshot was found.' : `A local database snapshot is present (newest modified ${Math.max(0, Math.floor((now - newest) / 86400000))} days ago).`, 'Presence/age does not verify recovery. Keep database, media and configuration in independent protected storage and rehearse restoration; local SQLite snapshots alone are not a full backup.');
  } catch {
    add('recovery', 'warn', 'Local database snapshot presence could not be checked.', 'Review the documented database, media and configuration recovery procedure. No backup was created or changed.');
  }
  if (offline) {
    add('http', 'skipped', 'Local HTTP checks were explicitly skipped.');
  } else {
    const port = String(env.PORT || '3000');
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      add('http', 'fail', 'PORT is invalid; no request was sent.', 'Use the application listener port, not a reverse-proxy or host-mapped port.');
    } else {
      // Never contact configured PUBLIC_ORIGIN or follow redirects; no cookies or credentials.
      const base = `http://127.0.0.1:${port}`;
      for (const [id, route, expected] of [
        ['health', '/healthz', 200],
        ['setup-route', '/setup', env.SETUP_ENABLED === '1' ? (owners > 0 ? 302 : 200) : 404],
        ['owner-access', '/admin', env.DEMO_MODE === '1' ? 200 : 303]
      ]) {
        try {
          const response = await fetcher(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'text/html' } });
          const matches = response.status === expected;
          let healthy = true;
          if (id === 'health' && matches) {
            const body = await response.json(); healthy = body?.ok === true;
          } else { await response.body?.cancel(); }
          add(id, matches && healthy ? 'pass' : 'fail', matches && healthy ? 'Local HTTP behavior matches the configured mode.' : 'Local HTTP behavior does not match the configured mode.', matches && healthy ? '' : 'Inspect private app logs and confirm this process uses the intended instance configuration. Response bodies and redirects are not included.');
        } catch {
          add(id, 'fail', 'Local HTTP check could not complete.', 'Check whether the app is running and PORT matches its listener. Use --offline only when intentionally inspecting a stopped instance.');
        }
      }
    }
  }
  return { version, ok: !checks.some(c => c.status === 'fail'), checks,
    scope: 'Read-only checks of this process configuration, data and loopback listener. Public TLS/routing, guest delivery and recoverability still require separate acceptance.' };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log('Usage: node scripts/doctor.mjs [--json] [--offline]\nDocker: docker compose exec -T app node scripts/doctor.mjs\nExit 0: no failed checks (warnings may remain); 1: failed check; 2: usage error.'); return 0; }
  if (args.some(arg => !['--json', '--offline'].includes(arg))) { console.error('Usage: node scripts/doctor.mjs [--json] [--offline]'); return 2; }
  const report = await diagnose({ offline: args.includes('--offline') });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Gatherframe ${report.version} — self-hosting checks`);
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.summary}${check.action ? '\n  Next: ' + check.action : ''}`);
    console.log(report.scope);
  }
  return report.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => { console.error('Diagnostics could not complete. Configuration and exception details are withheld.'); process.exitCode = 1; });
}
