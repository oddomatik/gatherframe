#!/usr/bin/env node
// Operator-only recovery. Passwords are read from the attached terminal, never argv/env.
'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const { Writable } = require('node:stream');
const readline = require('node:readline');
const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
const Database = appRequire('better-sqlite3');
const { hash } = appRequire('@node-rs/argon2');

function validatePassword(password, confirmation) {
  if (password !== confirmation) throw new Error('The passwords did not match. Nothing was changed.');
  if (password.length < 10) throw new Error('Use at least 10 characters. Nothing was changed.');
  if (password.length > 1024 || /[\x00-\x1f\x7f]/.test(password)) throw new Error('Use a password of at most 1024 characters without control characters. Nothing was changed.');
}

async function resetAccount(db, account, password, confirmation) {
  validatePassword(password, confirmation);
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  // A second recovery or account edit during hashing must not be silently overwritten.
  return db.transaction(() => {
    const current = db.prepare('SELECT id, email, password_hash FROM admin_users WHERE id = ?').get(account.id);
    if (!current || current.email !== account.email || current.password_hash !== account.password_hash) {
      throw new Error('The account changed during recovery. Nothing was changed; run the command again.');
    }
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(passwordHash, account.id);
    const sessions = db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(account.id).changes;
    return { email: current.email, sessionsRevoked: sessions };
  }).immediate();
}

function readSecret(label) {
  return new Promise((resolve, reject) => {
    const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; rl.close(); muted.end(); process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    rl.once('SIGINT', () => finish(new Error('Cancelled. Nothing was changed.')));
    rl.once('close', () => { if (!settled) finish(new Error('Terminal closed. Nothing was changed.')); });
    // Raw/no-echo mode must be active before inviting input (including fast paste).
    process.stdout.write(label);
    rl.question('', value => finish(null, value));
  });
}

async function main(args = process.argv.slice(2)) {
  let inspect = false, email = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--inspect') inspect = true;
    else if (args[i] === '--email' && args[i + 1] && !args[i + 1].startsWith('--')) email = args[++i].trim().toLowerCase();
    else throw new Error('Usage: reset-admin.cjs [--inspect] [--email LOGIN_EMAIL]. Passwords cannot be passed as arguments.');
  }
  if (!inspect && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('A private interactive terminal is required. Use ssh -t and docker exec -it; passwords cannot be piped.');
  const db = new Database(path.join(process.env.DATA_DIR || './data', 'db/app.sqlite'), { readonly: inspect, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const accounts = db.prepare('SELECT id, email FROM admin_users ORDER BY id').all();
    if (inspect) { console.log(JSON.stringify({ accounts })); return; }
    const selected = email ? accounts.find(a => a.email === email) : accounts.length === 1 ? accounts[0] : null;
    if (!selected) throw new Error(accounts.length ? 'Choose an existing account with --email LOGIN_EMAIL. Use --inspect to list login emails.' : 'No existing account. Recovery does not create accounts.');
    const account = db.prepare('SELECT id, email, password_hash FROM admin_users WHERE id = ?').get(selected.id);
    console.log(`Gatherframe password reset for ${account.email}`);
    console.log('Your typing is hidden. Existing login sessions will end after a successful reset.');
    let password = await readSecret('New password (at least 10 characters): ');
    let confirmation = await readSecret('Repeat new password: ');
    const result = await resetAccount(db, account, password, confirmation);
    password = confirmation = '';
    console.log(`Password updated for ${result.email}. Previous sessions closed: ${result.sessionsRevoked}.`);
    console.log('Sign in at your instance at /admin');
  } finally { db.close(); }
}

module.exports = { validatePassword, resetAccount };
if (require.main === module) main().catch(error => {
  // Avoid dumping database paths, password buffers, SQL bindings, or stack traces.
  const safe = /^(The passwords|Use at least|Use a password|The account changed|Cancelled\.|Terminal closed\.|Usage:|A private interactive|Choose an existing|No existing)/.test(error.message || '');
  console.error(safe ? error.message : 'Password reset failed. No success was confirmed; check the application database and retry.');
  process.exitCode = 1;
});
