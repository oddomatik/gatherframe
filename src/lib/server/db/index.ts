import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import { env, nowIso } from '../env';
import * as schema from './schema';
import { MIGRATIONS } from './migrations';

const dbPath = path.join(env.dataDir, 'db', 'app.sqlite');

function open() {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(sqlite.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: string }).id));
  const known = new Set(MIGRATIONS.map(m => m.id));
  if ([...applied].some(id => !known.has(id))) {
    sqlite.close();
    throw new Error('Database contains migrations unknown to this release. Refusing an unsafe downgrade; use a compatible release or restore a verified backup into a separate volume.');
  }
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, nowIso());
    })();
    console.log(`[db] applied migration ${m.id}`);
  }
  return sqlite;
}

// One connection per process; survives Vite HMR via globalThis.
const g = globalThis as unknown as { __pk_sqlite?: Database.Database };
export const sqlite: Database.Database = g.__pk_sqlite ?? (g.__pk_sqlite = open());
export const db = drizzle(sqlite, { schema });
export { schema };
export type Db = typeof db;
