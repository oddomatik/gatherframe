'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { verify, hash } = require('@node-rs/argon2');
const { resetAccount, validatePassword } = require('./reset-admin.cjs');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE admin_users(id INTEGER PRIMARY KEY,email TEXT,password_hash TEXT);
    CREATE TABLE admin_sessions(id TEXT PRIMARY KEY,user_id INTEGER);
    CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO admin_users VALUES(1,'owner@example.invalid','old-hash'),(2,'other@example.invalid','other-hash');
    INSERT INTO admin_sessions VALUES('owner-one',1),('owner-two',1),('other-one',2);
    INSERT INTO events VALUES(1,'Keep this event');`);
  return { db, account: db.prepare('SELECT * FROM admin_users WHERE id=1').get() };
}
test('reset verifies through normal Argon2 and revokes only the selected account sessions', async () => {
  const { db, account } = fixture();
  try {
    const result = await resetAccount(db, account, 'synthetic recovery password', 'synthetic recovery password');
    assert.equal(result.sessionsRevoked, 2);
    const owner = db.prepare('SELECT * FROM admin_users WHERE id=1').get();
    assert.equal(owner.email, account.email); assert.equal(await verify(owner.password_hash, 'synthetic recovery password'), true);
    assert.equal(db.prepare('SELECT password_hash FROM admin_users WHERE id=2').get().password_hash, 'other-hash');
    assert.deepEqual(db.prepare('SELECT * FROM admin_sessions').all(), [{ id: 'other-one', user_id: 2 }]);
    assert.equal(db.prepare('SELECT name FROM events').get().name, 'Keep this event');
  } finally { db.close(); }
});
test('mismatch and invalid password leave credentials and sessions unchanged', async () => {
  const { db, account } = fixture();
  try {
    await assert.rejects(resetAccount(db, account, 'long enough password', 'different password'), /did not match/);
    await assert.rejects(resetAccount(db, account, 'short', 'short'), /10 characters/);
    assert.throws(() => validatePassword('long but\ninvalid password', 'long but\ninvalid password'), /control characters/);
    assert.equal(db.prepare('SELECT password_hash FROM admin_users WHERE id=1').get().password_hash, 'old-hash');
    assert.equal(db.prepare('SELECT count(*) n FROM admin_sessions').get().n, 3);
  } finally { db.close(); }
});
test('a stale account snapshot cannot overwrite a newer password', async () => {
  const { db, account } = fixture();
  try {
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=1').run('changed-elsewhere');
    await assert.rejects(resetAccount(db, account, 'synthetic recovery password', 'synthetic recovery password'), /account changed/);
    assert.equal(db.prepare('SELECT password_hash FROM admin_users WHERE id=1').get().password_hash, 'changed-elsewhere');
    assert.equal(db.prepare('SELECT count(*) n FROM admin_sessions').get().n, 3);
  } finally { db.close(); }
});
