/** In-memory sliding-window limiter. One process, so a Map is enough. */
const buckets = new Map<string, number[]>();
let sweepAt = 0;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (now > sweepAt) { sweepAt = now + 60_000; for (const [k, arr] of buckets) { const keep = arr.filter((t) => now - t < 3_600_000); if (keep.length) buckets.set(k, keep); else buckets.delete(k); } }
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - arr[0])) / 1000) }; }
  arr.push(now); buckets.set(key, arr);
  return { ok: true, retryAfterSec: 0 };
}
