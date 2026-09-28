import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { db, schema } from '$server/db';
import { fulfillment } from '$server/fulfillment';
import { getOrderDetail, pickList } from '$server/orders';
import { attachmentHeader, safeSegment, zipStream, ZipError, type ZipEntry } from '$server/zip';
import { printReadiness, printRevision } from '$server/production';

/** Only approved, present print masters; production conflicts are resolved explicitly by the owner. */
export const GET: RequestHandler = async (e) => {
  const d = getOrderDetail(Number(e.params.id));
  if (!d) throw error(404, 'order not found');
  const work=fulfillment(d), reviewOnly=e.url.searchParams.get('purpose')==='review';
  if(d.order.status==='cancelled') throw error(409,'Reopen this cancelled order before preparing files.');
  if(!reviewOnly && work.editable && !work.reviewComplete) return json({code:'PREPARATION_NEEDS_REVIEW',message:'Review photos and address special requests before downloading production files. Sources for touch-ups remain available.'},{status:409});
  const stillReviewed=()=>{const current=getOrderDetail(d.order.id); return current && fulfillment(current).revision===work.revision;};
  const photoIds = [...new Set(d.items.flatMap((i) => i.sheets.flatMap((s) => s.cells.map((c) => c.photoId).filter((x): x is number => x != null))))];
  const files = photoIds.length ? db.select().from(schema.photoFiles).where(and(inArray(schema.photoFiles.photoId, photoIds), eq(schema.photoFiles.role, 'print'))).all() : [];
  const readiness = await printReadiness(d);
  if (!readiness.ready) return json({ code: 'PRINT_MASTERS_NEED_REVIEW', message: 'Review the missing or changed print masters before preparing this order.', conflicts: readiness.conflicts }, { status: 409 });
  if (readiness.revision !== printRevision(d) || !stillReviewed()) throw error(409, 'The print masters changed. Please refresh and review the order.');
  const entries: ZipEntry[] = [];
  for (const item of d.items) for (const sheet of item.sheets) for (const c of sheet.cells) {
    const f = files.find((x) => x.photoId === c.photoId && x.role === 'print');
    // Keep the captured immutable master tied to the accepted order, even if another request
    // replaces the current file while remote readiness checks are in flight.
    if (!f || !c.printSha256 || f.sha256 !== c.printSha256) throw error(409, 'The print masters changed. Please refresh and review the order.');
    const name = `${d.order.orderNumber}/${safeSegment(`item${item.id}-${item.productCode}`)}/sheet${sheet.sheetIndex + 1}-cell${c.cellIndex + 1}-${safeSegment(c.sizeChoice ?? c.printSizeCode)}-${safeSegment(c.photoStem)}${f ? `.${f.ext}` : ''}`;
    entries.push({ storagePath: f.storagePath, name, expectedBytes: f.bytes, expectedSha256: f.sha256 });
  }
  const text = [reviewOnly?'SOURCE FILES FOR REVIEW — NOT APPROVED FOR PRINTING':'PRODUCTION FILES', `Requests: ${d.order.notes ?? ''} ${work.extraRequests}`, ...work.photos.filter(p=>p.parentNote).map(p=>`${p.stem} · Customer request: ${p.parentNote}`), ...work.photos.filter(p=>p.note).map(p=>`${p.stem}: ${p.note}`), `Order ${d.order.orderNumber}`, `${d.order.customerName} · ${d.order.phone ?? ''} ${d.order.email ?? ''}`, `For: ${d.order.subjectName ?? ''}`, '', ...pickList(d), '', `Print each item ${'x'} its quantity.`].join('\n');
  entries.push({ content: text, name: `${d.order.orderNumber}/pick-list.txt` });
  let archive;
  try { archive = await zipStream(entries, e.request.signal); }
  catch (err) { if (err instanceof ZipError) throw error(err.status, err.message); throw err; }
  if (readiness.revision !== printRevision(d) || !stillReviewed()) { archive.destroy(); throw error(409, 'The print masters changed. Please refresh and review the order.'); }
  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, { headers: { 'content-type': 'application/zip', 'content-disposition': attachmentHeader(`${d.order.orderNumber}-print-files.zip`), 'cache-control': 'no-store' } });
};
