import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { getOrderDetail, OrderError } from './orders';
import { nowIso } from './env';
import { objectStat } from './blob-store';

/** Approve exactly the masters reviewed on screen; a concurrent replacement needs fresh review. */
export async function approvePrintMasters(orderId: number, reviewed: { cellId: number; sha256: string }[], actor: string, reason: string) {
  if (!reason.trim()) throw new OrderError(400, 'Add a short reason for this production change');
  const initial = getOrderDetail(orderId);
  if (!initial) throw new OrderError(404, 'Order not found');
  const initialCells = initial.items.flatMap((i) => i.sheets.flatMap((s) => s.cells));
  const verified = new Map<number, string>();
  for (const review of reviewed) {
    const cell = initialCells.find((c) => c.id === review.cellId);
    if (!cell?.photoId) throw new OrderError(409, 'The selected print no longer has a photo');
    const file = db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.photoId, cell.photoId), eq(schema.photoFiles.role, 'print'))).get();
    if (!file || file.sha256 !== review.sha256) throw new OrderError(409, 'A master changed again. Reload and review it before approving.');
    if (!verified.has(file.id)) {
      try { const st = await objectStat(file.storagePath); if (st.size !== file.bytes || (st.sha256 && st.sha256 !== file.sha256)) throw new Error(); }
      catch { throw new OrderError(409, 'The print master is missing or unavailable. Restore access before approving.'); }
      verified.set(file.id, JSON.stringify(file));
    }
  }
  return sqlite.transaction(() => {
    const d = getOrderDetail(orderId);
    if (!d) throw new OrderError(404, 'Order not found');
    if (!['new', 'in_progress'].includes(d.order.status)) throw new OrderError(409, 'Reopen this order before changing its production masters');
    const cells = d.items.flatMap((i) => i.sheets.flatMap((s) => s.cells));
    const changes: { cellId: number; photoId: number; before: string | null; after: string }[] = [];
    for (const review of reviewed) {
      const cell = cells.find((c) => c.id === review.cellId);
      if (!cell?.photoId) throw new OrderError(409, 'The selected print no longer has a photo');
      const file = db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.photoId, cell.photoId), eq(schema.photoFiles.role, 'print'))).get();
      if (!file || file.sha256 !== review.sha256) throw new OrderError(409, 'A master changed again. Reload and review it before approving.');
      if (verified.get(file.id) !== JSON.stringify(file)) throw new OrderError(409, 'A master changed again. Reload and review it before approving.');
      if (cell.printSha256 !== file.sha256) {
        changes.push({ cellId: cell.id, photoId: cell.photoId, before: cell.printSha256, after: file.sha256 });
        db.update(schema.orderItemCells).set({ printSha256: file.sha256 }).where(eq(schema.orderItemCells.id, cell.id)).run();
      }
    }
    if (changes.length) db.insert(schema.orderEvents).values({ orderId, type: 'print_masters_approved', actor, data: { reason: reason.trim(), changes }, createdAt: nowIso() }).run();
    return changes.length;
  })();
}
