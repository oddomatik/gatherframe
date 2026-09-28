import { inArray, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { objectStat } from './blob-store';
import type { getOrderDetail } from './orders';

export interface PrintConflict {
  cellId: number;
  photoId: number | null;
  photoStem: string;
  reason: 'missing_photo' | 'missing_print' | 'changed_print' | 'unapproved_print' | 'missing_file';
  orderedSha256: string | null;
  currentSha256: string | null;
}

type OrderDetail = NonNullable<ReturnType<typeof getOrderDetail>>;
function masterState(detail: OrderDetail) {
  const cells = detail.items.flatMap((i) => i.sheets.flatMap((s) => s.cells));
  const ids = [...new Set(cells.map((c) => c.photoId).filter((id): id is number => id != null))];
  const photos = ids.length ? db.select({ id: schema.photos.id }).from(schema.photos).where(inArray(schema.photos.id, ids)).all() : [];
  const files = ids.length ? db.select().from(schema.photoFiles).where(inArray(schema.photoFiles.photoId, ids)).all().filter((f) => f.role === 'print') : [];
  const approved = cells.length ? db.select().from(schema.orderItemCells).where(inArray(schema.orderItemCells.id, cells.map((c) => c.id))).all() : [];
  const order = detail.order ? db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, detail.order.id)).get() : null;
  return { cells, photos, files, approved, order };
}
/** Synchronous fence: async remote checks must not authorize a changed order or file. */
export function printRevision(detail: OrderDetail): string { return JSON.stringify(masterState(detail)); }

type Master = typeof schema.photoFiles.$inferSelect;
/** One page/export gets bounded, deduplicated checks. A provider outage trips this request only. */
export function createPrintInspection() {
  const cache = new Map<string, Promise<boolean>>();
  let active = 0, unavailable = false;
  const waiters: (() => void)[] = [];
  return (file: Master): Promise<boolean> => {
    const key = `${file.storagePath}:${file.sha256}:${file.bytes}`;
    const cached = cache.get(key); if (cached) return cached;
    const check = (async () => {
      if (active >= 4) await new Promise<void>((resolve) => waiters.push(resolve)); else active++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (unavailable) return false;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Storage timed out'), { code: 'remote_unavailable' })), 10_000); });
        const st = await Promise.race([objectStat(file.storagePath), timeout]);
        return st.size === file.bytes && (!st.sha256 || st.sha256 === file.sha256);
      } catch (e) {
        if (['remote_unavailable', 'not_configured', 'invalid_target'].includes((e as { code?: string }).code ?? '')) unavailable = true;
        return false;
      } finally {
        clearTimeout(timer);
        const next = waiters.shift(); if (next) next(); else active--;
      }
    })();
    cache.set(key, check); return check;
  };
}

/** The exact current master must be present and approved for every ordered print. Never use social. */
export async function printReadiness(detail: OrderDetail, inspect = createPrintInspection()): Promise<{ ready: boolean; conflicts: PrintConflict[]; revision: string }> {
  const state = masterState(detail);
  const revision = JSON.stringify(state);
  const { cells, files } = state;
  const photos = new Set(state.photos.map((p) => p.id));
  const present = new Set<number>();
  await Promise.all(files.map(async (file) => { if (await inspect(file)) present.add(file.id); }));
  const changed = printRevision(detail) !== revision;
  const conflicts: PrintConflict[] = [];
  for (const cell of cells) {
    const file = files.find((f) => f.photoId === cell.photoId);
    let reason: PrintConflict['reason'] | null = null;
    if (cell.photoId == null || !photos.has(cell.photoId)) reason = 'missing_photo';
    else if (!file) reason = 'missing_print';
    else if (!present.has(file.id)) reason = 'missing_file';
    else if (!cell.printSha256) reason = 'unapproved_print';
    else if (cell.printSha256 !== file.sha256 || changed) reason = 'changed_print';
    if (reason) conflicts.push({ cellId: cell.id, photoId: cell.photoId, photoStem: cell.photoStem, reason, orderedSha256: cell.printSha256, currentSha256: file?.sha256 ?? null });
  }
  return { ready: !changed && conflicts.length === 0, conflicts, revision };
}
