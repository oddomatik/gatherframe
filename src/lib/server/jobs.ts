import { and, eq, lt, sql } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { nowIso } from './env';
import type { Job } from './db/schema';

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;
const handlers = new Map<string, Handler>();
const perTypeCap: Record<string, number> = { render_photo: 2, render_delivery: 2, build_zip: 1, deliver_notification: 1, delete_files: 2, sweep: 1, backup: 1 };
const running = new Map<number, string>();
const MAX_CONCURRENT = 6;
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export function registerHandler(type: string, fn: Handler): void { handlers.set(type, fn); }

export function enqueue(type: string, payload: Record<string, unknown>, opts: { runAt?: Date; priority?: number; dedupeKey?: string } = {}): number {
  if (opts.dedupeKey) {
    const existing = db.select({ id: schema.jobs.id }).from(schema.jobs)
      .where(and(eq(schema.jobs.type, type), eq(schema.jobs.status, 'queued'), sql`json_extract(${schema.jobs.payload}, '$.dedupeKey') = ${opts.dedupeKey}`)).get();
    if (existing) {
      // An immediate request must not get stuck behind an older delayed deduped job.
      const requestedAt = (opts.runAt ?? new Date()).toISOString();
      db.update(schema.jobs).set({ runAt: sql`min(${schema.jobs.runAt}, ${requestedAt})`, priority: sql`max(${schema.jobs.priority}, ${opts.priority ?? 0})` }).where(eq(schema.jobs.id, existing.id)).run();
      return existing.id;
    }
    payload = { ...payload, dedupeKey: opts.dedupeKey };
  }
  return db.insert(schema.jobs).values({ type, payload, priority: opts.priority ?? 0, status: 'queued', runAt: (opts.runAt ?? new Date()).toISOString(), createdAt: nowIso() }).returning().get().id;
}

function claim(): Job | null {
  const now = nowIso();
  const busyTypes = [...running.values()].reduce<Record<string, number>>((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
  const excluded = Object.entries(perTypeCap).filter(([t, cap]) => (busyTypes[t] ?? 0) >= cap).map(([t]) => t);
  if ((busyTypes.render_photo ?? 0) + (busyTypes.render_delivery ?? 0) >= 2) excluded.push('render_photo', 'render_delivery');
  const typeFilter = excluded.length ? `AND type NOT IN (${excluded.map(() => '?').join(',')})` : '';
  const row = sqlite.prepare(`
    UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs candidate WHERE status = 'queued' AND run_at <= ? ${typeFilter}
      AND (type != 'render_photo' OR NOT EXISTS (SELECT 1 FROM jobs active WHERE active.status = 'running' AND active.type = 'render_photo' AND json_extract(active.payload, '$.photoId') = json_extract(candidate.payload, '$.photoId')))
      ORDER BY priority + min(10, max(0, (unixepoch('now') - unixepoch(created_at)) / 60)) DESC, id LIMIT 1)
    RETURNING *`).get(now, now, ...excluded) as Record<string, unknown> | undefined;
  if (!row) return null;
  return db.select().from(schema.jobs).where(eq(schema.jobs.id, row.id as number)).get() ?? null;
}

async function runOne(job: Job): Promise<void> {
  running.set(job.id, job.type);
  try {
    const h = handlers.get(job.type);
    if (!h) throw new Error(`no handler for ${job.type}`);
    await h(job.payload, job);
    db.delete(schema.jobs).where(eq(schema.jobs.id, job.id)).run();
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    console.error(`[jobs] ${job.type}#${job.id} failed (attempt ${job.attempts}): ${msg}`);
    if (job.attempts >= MAX_ATTEMPTS) db.update(schema.jobs).set({ status: 'dead', lastError: msg, lockedAt: null }).where(eq(schema.jobs.id, job.id)).run();
    else {
      const backoffMs = Math.min(3_600_000, 30_000 * 2 ** (job.attempts - 1));
      db.update(schema.jobs).set({ status: 'queued', lastError: msg, lockedAt: null, runAt: new Date(Date.now() + backoffMs).toISOString() }).where(eq(schema.jobs.id, job.id)).run();
    }
  } finally {
    running.delete(job.id);
    // Refill a freed slot immediately; the polling interval is only for newly
    // enqueued work, not an artificial pause between every image in a batch.
    queueMicrotask(tick);
  }
}

function tick(): void {
  while (running.size < MAX_CONCURRENT) {
    const job = claim();
    if (!job) break;
    void runOne(job);
  }
}

/** Requeue jobs whose lease expired (crash mid-run), then start the polling loop once per process. */
export function startJobRunner(): void {
  const g = globalThis as unknown as { __pk_jobs?: boolean };
  if (g.__pk_jobs) return;
  g.__pk_jobs = true;
  const stale = new Date(Date.now() - LEASE_MS).toISOString();
  db.update(schema.jobs).set({ status: 'queued', lockedAt: null }).where(and(eq(schema.jobs.status, 'running'), lt(schema.jobs.lockedAt, stale))).run();
  // Anything still marked running at boot belongs to a dead process.
  db.update(schema.jobs).set({ status: 'queued', lockedAt: null }).where(eq(schema.jobs.status, 'running')).run();
  setInterval(tick, 1500).unref();
  setTimeout(tick, 200);
  console.log('[jobs] runner started');
}

export function jobStats() {
  return db.select({ status: schema.jobs.status, type: schema.jobs.type, n: sql<number>`count(*)` }).from(schema.jobs).groupBy(schema.jobs.status, schema.jobs.type).all();
}
export function retryDeadJobs(): number {
  return db.update(schema.jobs).set({ status: 'queued', attempts: 0, runAt: nowIso() }).where(eq(schema.jobs.status, 'dead')).run().changes;
}
