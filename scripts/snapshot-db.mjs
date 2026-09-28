#!/usr/bin/env node
// Consistent SQLite online backup. This does NOT copy media, configuration, or B2 objects.
import Database from 'better-sqlite3';
import { chmod, mkdir, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) throw Error('Usage: node scripts/snapshot-db.mjs /private/path/snapshot.sqlite');
const source = path.resolve(process.env.DATA_DIR || './data', 'db/app.sqlite');
const output = path.resolve(destination);
if (source === output) throw Error('Backup destination must differ from the live database.');
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.${randomUUID()}.tmp`;
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(temporary);
  await chmod(temporary, 0o600);
  const check = new Database(temporary, { readonly: true, fileMustExist: true });
  try {
    if (check.pragma('quick_check', { simple: true }) !== 'ok' || check.pragma('foreign_key_check').length)
      throw Error('Backup integrity check failed.');
  } finally { check.close(); }
  // Atomic publication without overwriting a previous snapshot.
  await link(temporary, output);
  console.log('Verified database snapshot created. Back up media and private configuration separately.');
} finally {
  db.close();
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
