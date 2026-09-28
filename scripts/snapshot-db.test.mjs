import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

test('backup includes committed WAL data, preserves source, and refuses an existing destination', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'picture-day-backup-test-'));
  mkdirSync(path.join(scratch, 'db'));
  const source = new Database(path.join(scratch, 'db/app.sqlite'));
  try {
    source.pragma('journal_mode=WAL'); source.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES (\'preserved\')');
    const output = path.join(scratch, 'backup.sqlite');
    const run = () => spawnSync(process.execPath, ['scripts/snapshot-db.mjs', output], { env: { ...process.env, DATA_DIR: scratch }, encoding: 'utf8' });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const restored = new Database(output, { readonly: true });
    assert.equal(restored.prepare('SELECT value FROM proof').get().value, 'preserved'); restored.close();
    source.exec("INSERT INTO proof VALUES ('newer')");
    assert.notEqual(run().status, 0);
    assert.equal(source.prepare('SELECT count(*) n FROM proof').get().n, 2);
    assert.equal(statSync(output).mode & 0o777, 0o600);
  } finally { source.close(); rmSync(scratch, { recursive: true, force: true }); }
});
