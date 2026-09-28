import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { getOrderDetail, OrderError, transitionOrder, type OrderDetail } from './orders';
import { nowIso } from './env';
import { printReadiness, printRevision } from './production';
import type { FulfillmentStage, PhotoWorkState } from '$shared/fulfillment';
import type { OrderStatus } from '$shared/orders';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fulfillment(detail: OrderDetail) {
  const o = detail.order;
  const requests = db.select().from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, o.id)).get();
  const saved = db.select().from(schema.orderPhotoWork).where(eq(schema.orderPhotoWork.orderId, o.id)).orderBy(schema.orderPhotoWork.photoKey).all();
  type Cell = OrderDetail['items'][number]['sheets'][number]['cells'][number];
  const grouped = new Map<string, { cells: Cell[]; prints: { size: string; count: number }[] }>();
  for (const item of detail.items) for (const sheet of item.sheets) for (const cell of sheet.cells) {
    const key = cell.photoId == null ? `cell:${cell.id}` : `photo:${cell.photoId}`;
    const group = grouped.get(key) ?? { cells: [], prints: [] };
    group.cells.push(cell);
    const size = cell.sizeChoice ?? cell.printSizeCode;
    const print = group.prints.find(p => p.size === size);
    if (print) print.count += item.quantity; else group.prints.push({ size, count: item.quantity });
    grouped.set(key, group);
  }
  const photos = [...grouped].map(([key, group]) => {
    const cell = group.cells[0], task = saved.find(t => t.photoKey === key);
    const matches = Boolean(cell.currentPrintSha && group.cells.every(c => c.printSha256 === cell.currentPrintSha));
    const stale = task?.state === 'ready' && (!matches || task.reviewedSha256 !== cell.currentPrintSha);
    const state: PhotoWorkState = stale ? 'needs_review' : (task?.state as PhotoWorkState | undefined) ?? 'needs_review';
    return { key, photoId: cell.photoId, stem: cell.photoStem, thumbHash: cell.thumbHash, cells: group.cells.map(c => c.id), prints: group.prints,
      parentNote: o.photoRequests?.[String(cell.photoId)] ?? '', state, note: task?.note ?? '', reviewedSha256: task?.reviewedSha256 ?? null, currentSha256: cell.currentPrintSha,
      masterMatches: matches, stale, reviewedAt: task?.state === 'ready' ? task.updatedAt : null };
  });
  const parentNotes = o.notes?.trim() ?? '', extraRequests = requests?.extraRequests ?? '';
  const photoRequests = Object.entries(o.photoRequests ?? {}).filter(([,note])=>note.trim()).sort(([a],[b])=>Number(a)-Number(b));
  const requestSnapshot = photoRequests.length ? JSON.stringify({notes:parentNotes, photos:photoRequests}) : parentNotes;
  const hasRequests = Boolean(parentNotes || extraRequests.trim() || photoRequests.length);
  const requestsAddressed = !hasRequests || Boolean(requests?.requestsReviewed && requests.reviewedParentNotes === requestSnapshot);
  const touchups = photos.filter(p => p.state === 'needs_touchup').length;
  const reviewed = photos.filter(p => p.state === 'ready' && p.masterMatches).length;
  const reviewComplete = photos.length > 0 && reviewed === photos.length && requestsAddressed;
  const editable = ['new', 'in_progress'].includes(o.status);
  const stage: FulfillmentStage = ['printed', 'delivered', 'cancelled'].includes(o.status) ? o.status as FulfillmentStage : touchups ? 'touchups' : reviewComplete ? 'ready' : 'review';
  const revision = digest({ status: o.status, notes: o.notes, photoRequests: o.photoRequests, requests, saved, masters: printRevision(detail), items: detail.items.map(i => [i.id, i.quantity]) });
  return { photos, parentNotes, requestSnapshot, extraRequests, hasRequests, requestsAddressed, touchups, reviewed, reviewComplete, editable, stage, revision };
}
export type WorkAction =
  | { kind: 'photo'; photoKey: string; state: PhotoWorkState; note: string }
  | { kind: 'requests'; notes: string }
  | { kind: 'resolve_requests' }
  | { kind: 'status'; to: OrderStatus };

/** Exact receipts precede stale checks. An uncertain save can be retried without duplicate transitions. */
export async function updateFulfillment(orderId: number, action: WorkAction, revision: string, actionId: string, actor: string) {
  if (!/^[A-Za-z0-9_:-]{8,160}$/.test(actionId) || !/^[a-f0-9]{64}$/.test(revision)) throw new OrderError(400, 'Reload this order before saving.');
  if (action.kind === 'photo' && (!['needs_review', 'needs_touchup', 'ready'].includes(action.state) || action.note.length > 2000)) throw new OrderError(400, 'Check the photo note and review status.');
  if (action.kind === 'requests' && action.notes.length > 4000) throw new OrderError(400, 'Keep additional requests under 4,000 characters.');
  const intent = JSON.stringify({ orderId, action, revision, actor });
  function receipt() {
    const old = db.select().from(schema.orderWorkActions).where(eq(schema.orderWorkActions.id, actionId)).get();
    if (!old) return null;
    if (old.orderId !== orderId || old.intent !== intent) throw new OrderError(409, 'This save already used different details. Reload the order.');
    return old.result;
  }
  const old = receipt(); if (old) return { ...old, replay: true };
  function fresh() {
    const d = getOrderDetail(orderId); if (!d) throw new OrderError(404, 'Order not found');
    const work = fulfillment(d);
    if (work.revision !== revision) throw new OrderError(409, 'This order or its photos changed in another tab. Reload and review before saving.');
    if (action.kind !== 'status' && !work.editable) throw new OrderError(409, 'Reopen this order before changing its preparation.');
    return { d, work };
  }
  const initial = fresh();
  const needsFileCheck = (action.kind === 'photo' && action.state === 'ready') || (action.kind === 'status' && action.to === 'printed');
  if (needsFileCheck) {
    const files = await printReadiness(initial.d);
    if (action.kind === 'photo') {
      const p = initial.work.photos.find(p => p.key === action.photoKey);
      if (!p || !p.masterMatches || files.conflicts.some(c => p.cells.includes(c.cellId))) throw new OrderError(409, 'Review and approve the available full-resolution master before marking this photo ready.');
    } else if ((!initial.work.reviewComplete && initial.d.order.status !== 'delivered') || !files.ready) {
      throw new OrderError(409, 'Finish photo reviews and address special requests before marking this order printed.');
    }
  }
  return sqlite.transaction(() => {
    const old = receipt(); if (old) return { ...old, replay: true };
    const { d, work } = fresh();
    const time = nowIso(); let message = '';
    if (action.kind === 'photo') {
      const p = work.photos.find(p => p.key === action.photoKey);
      if (!p) throw new OrderError(404, 'Photo is not in this order');
      const values = { orderId, photoKey: p.key, state: action.state, note: action.note.trim(), reviewedSha256: action.state === 'ready' ? p.currentSha256 : null, updatedAt: time };
      db.insert(schema.orderPhotoWork).values(values).onConflictDoUpdate({ target: [schema.orderPhotoWork.orderId, schema.orderPhotoWork.photoKey], set: values }).run();
      message = action.state === 'ready' ? 'Photo ready to print' : 'Photo preparation saved';
      db.insert(schema.orderEvents).values({ orderId, type: 'photo_preparation', actor, data: { photo: p.stem, from: p.state, to: action.state, note: values.note, reviewedSha256: values.reviewedSha256 }, createdAt: time }).run();
    } else if (action.kind === 'requests' || action.kind === 'resolve_requests') {
      const notes = action.kind === 'requests' ? action.notes.trim() : work.extraRequests;
      const resolved = action.kind === 'resolve_requests' || (notes === work.extraRequests && work.requestsAddressed);
      const values = { orderId, extraRequests: notes, requestsReviewed: resolved ? 1 : 0, reviewedParentNotes: resolved ? work.requestSnapshot : null, updatedAt: time };
      db.insert(schema.orderFulfillment).values(values).onConflictDoUpdate({ target: schema.orderFulfillment.orderId, set: values }).run();
      message = action.kind === 'resolve_requests' ? 'Special requests addressed' : 'Special requests saved';
      db.insert(schema.orderEvents).values({ orderId, type: action.kind === 'resolve_requests' ? 'requests_addressed' : 'special_requests', actor, data: { notes, parentNotes: work.parentNotes }, createdAt: time }).run();
    } else {
      transitionOrder(orderId, action.to, actor);
      if (['printed', 'delivered', 'cancelled'].includes(d.order.status) && ['new', 'in_progress'].includes(action.to)) {
        db.update(schema.orderPhotoWork).set({ state: 'needs_review', reviewedSha256: null, updatedAt: time }).where(eq(schema.orderPhotoWork.orderId, orderId)).run();
        db.update(schema.orderFulfillment).set({ requestsReviewed: 0, reviewedParentNotes: null, updatedAt: time }).where(eq(schema.orderFulfillment.orderId, orderId)).run();
      }
      message = 'Status updated';
    }
    db.insert(schema.orderWorkActions).values({ id: actionId, orderId, intent, result: { message }, createdAt: time }).run();
    return { message, replay: false };
  })();
}
