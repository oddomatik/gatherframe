import { isVariantRole, type UploadRole } from '$shared/stem';
import { versionFor, deliverySourceChanged } from './delivery';
import { Server, Upload } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { sqlite } from './db';
import { env, nowIso } from './env';
import { storage, withStorageLock } from './storage';
import { assertScratchSpace, objectStat } from './blob-store';
import { ingestUpload, IngestError, type UploadInput, type IngestResult } from './ingest';
import { listImportPhotos } from './import-photos';
import { validateTagIds } from './tags';
import { photoKey } from '$shared/photo-key';
import { isAcceptedUpload, sidecarRole, RAW_EXTENSIONS, splitExtension } from '$shared/stem';
import { MAX_XMP_BYTES } from './sidecars';

const DAY = 86400_000;
export const CHUNK_BYTES = 8 * 1024 * 1024;
const directory = storage.abs('resumable');
const store = new FileStore({ directory });
const server = new Server({ path: '/admin/api/transfers', datastore: store, maxSize: env.maxUploadBytes, relativeLocation: true, allowedOrigins: [] });
const inputSchema = z.object({
  galleryId: z.number().int().positive(), filename: z.string().min(1).max(255).refine(v => !/[\\/\x00-\x1f]/.test(v)),
  role: z.string().refine(v => isVariantRole(v) || v === 'xmp' || v === 'acr').transform(v => v as UploadRole), bytes: z.number().int().positive().safe(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  replacement: z.enum(['reject','replace']).default('reject'), stemOverride: z.string().min(1).max(200).regex(/^[^\\/\x00-\x1f]+$/).optional(),
  tagIds: z.array(z.number().int().positive()).max(200).default([])
}).strict();
type Contract = z.infer<typeof inputSchema> & { eventId: number; expectedVersion: string|null; expectedPhotoId: number|null };
type Session = { id:string; user_id:number; event_id:number; fingerprint:string; input:string; bytes:number; result:string|null; expires_at:string };
function readSession(id: string, actor: number, eventId?: number) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new IngestError(404, 'Transfer not found.');
  const row = sqlite.prepare('SELECT * FROM upload_sessions WHERE id=? AND user_id=?').get(id,actor) as Session|undefined;
  if (!row || (eventId !== undefined && row.event_id !== eventId)) throw new IngestError(404, 'Transfer not found.');
  if (row.expires_at <= nowIso()) throw new IngestError(410, 'This transfer expired. Reselect the file to start a new transfer.');
  return row;
}

/** Preflight is scoped to the signed-in owner, project, photo and exact file role. */
export async function prepareTransfer(eventId:number, actor:number, raw:unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new IngestError(400, 'Invalid transfer details. Reselect the file.');
  const input = parsed.data;
  if (!sqlite.prepare('SELECT 1 FROM galleries WHERE id=? AND event_id=? AND is_archived=0').get(input.galleryId,eventId)) throw new IngestError(409,'Choose an active collection in this project.');
  if (!['xmp','acr'].includes(input.role) && !versionFor(eventId,input.role)) throw new IngestError(400,'Choose a delivery version in this project.');
  if (!isAcceptedUpload(input.filename)) throw new IngestError(415,'Unsupported file type.');
  const sidecar = sidecarRole(input.filename), ext = splitExtension(input.filename).ext;
  if ((sidecar && sidecar !== input.role) || (!sidecar && ['xmp','acr'].includes(input.role)) || (RAW_EXTENSIONS.has(ext) && input.role !== 'raw')) throw new IngestError(400,'File type and version do not match.');
  if (input.bytes > (sidecar==='xmp' ? Math.min(MAX_XMP_BYTES,env.maxUploadBytes) : env.maxUploadBytes)) throw new IngestError(413,'File too large.');
  try { validateTagIds(eventId,input.tagIds); } catch { throw new IngestError(400,'A batch tag is no longer available.'); }
  const base=photoKey(input.filename), stem=input.stemOverride?.normalize('NFC').toLowerCase().trim() || base;
  let candidates=listImportPhotos(eventId).filter(p=>stem!==base?p.stem===stem:p.matchKeys.includes(stem));
  const currentFile=(p:typeof candidates[number])=>sidecar?p.sidecars.find(f=>f.kind===sidecar):p.files.find(f=>f.role===input.role);
  if (candidates.length>1) { const exact=candidates.filter(p=>currentFile(p)?.sha256===input.sha256);if(exact.length===1)candidates=exact; }
  if (candidates.length>1) throw new IngestError(409,'More than one photo matches this filename. Resolve the duplicate or keep it separate.');
  const photo=candidates[0], file=photo&&currentFile(photo);
  if (file?.sha256===input.sha256 && file.bytes===input.bytes && (sidecar || !('origin' in file) || file.origin === 'uploaded')) {
    try {
      const st=await objectStat(file.storagePath);
      if(st.size===file.bytes && (!st.sha256||st.sha256===file.sha256)) {
        const stillCurrent=sqlite.prepare(sidecar?'SELECT sha256 FROM photo_sidecars WHERE photo_id=? AND kind=?':'SELECT sha256 FROM photo_files WHERE photo_id=? AND role=?').get(photo.id,sidecar??input.role) as {sha256:string}|undefined;
        if(stillCurrent?.sha256!==file.sha256) throw new IngestError(409,'Another upload changed this version. Review this file before retrying.');
        // Even a byte-identical authored upload is a fresh override decision.
        // Cancel any explicitly resumed automatic job before returning the fast receipt.
        if (!sidecar) sqlite.transaction(() => {
          sqlite.prepare('UPDATE photo_files SET needs_review=0 WHERE id=?').run(file.id);
          deliverySourceChanged(photo.id,input.role,false);
        })();
        return {result:{status:'unchanged',photoId:photo.id,fileId:file.id,stem:photo.stem,role:input.role,bytes:file.bytes,sha256:file.sha256} satisfies IngestResult};
      }
    } catch(err) { if(err instanceof IngestError)throw err; /* Retransfer known bytes to repair an unavailable stored object. */ }
  }
  if (file && file.sha256!==input.sha256 && input.replacement!=='replace') throw new IngestError(409,'This version has changed. Choose Update existing versions in this batch to replace it.');
  const contract:Contract={...input,tagIds:[...new Set(input.tagIds)].sort((a,b)=>a-b),eventId,expectedVersion:file?.sha256??null,expectedPhotoId:photo?.id??null};
  const fingerprint=createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return withStorageLock('transfer-new',async()=>{
    const old=sqlite.prepare('SELECT * FROM upload_sessions WHERE user_id=? AND event_id=? AND fingerprint=? AND expires_at>? AND result IS NULL ORDER BY created_at DESC LIMIT 1').get(actor,eventId,fingerprint,nowIso()) as Session|undefined;
    if(old) {
      try { const upload=await store.getUpload(old.id);return {id:old.id,url:`/admin/api/transfers/${old.id}`,offset:upload.offset,expiresAt:old.expires_at,chunkBytes:CHUNK_BYTES}; }
      catch { sqlite.prepare('DELETE FROM upload_sessions WHERE id=?').run(old.id); }
    }
    const pending=sqlite.prepare('SELECT coalesce(sum(bytes),0) n FROM upload_sessions WHERE result IS NULL AND expires_at>?').get(nowIso()) as {n:number};
    if(pending.n+input.bytes>32*1024**3) throw new IngestError(507,'Pending transfers have reached 32 GB. Finish existing transfers first.');
    await assertScratchSpace(input.bytes*2);
    const id=randomUUID(), expiresAt=new Date(Date.now()+7*DAY).toISOString();
    await store.create(new Upload({id,size:input.bytes,offset:0,metadata:{},creation_date:nowIso()}));
    sqlite.prepare('INSERT INTO upload_sessions(id,user_id,event_id,fingerprint,input,bytes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(id,actor,eventId,fingerprint,JSON.stringify(contract),input.bytes,nowIso(),expiresAt);
    return {id,url:`/admin/api/transfers/${id}`,offset:0,expiresAt,chunkBytes:CHUNK_BYTES};
  });
}

export async function receiveTransfer(id:string,actor:number,request:Request) {
  return withStorageLock(`transfer:${id}`,async()=>{
    const row=readSession(id,actor);
    if(!['HEAD','PATCH','OPTIONS'].includes(request.method)) throw new IngestError(405,'Method not allowed.');
    if(request.method==='PATCH') {
      if(row.result) throw new IngestError(409,'Transfer already finalized.');
      const length=Number(request.headers.get('content-length'));
      if(!Number.isSafeInteger(length)||length<1||length>CHUNK_BYTES) throw new IngestError(413,'Send transfer chunks of at most 8 MB.');
      await assertScratchSpace(length);
    }
    const response=await server.handleWeb(request);
    // Do not acknowledge durable offset until bytes are synced to disk.
    if(['PATCH','HEAD'].includes(request.method) && response.ok) { const h=await fs.open(`${directory}/${id}`,'r');try{await h.sync();}finally{await h.close();} }
    response.headers.set('cache-control','private, no-store');return response;
  });
}

export async function finishTransfer(id:string,eventId:number,actor:number) {
  return withStorageLock(`transfer:${id}`,async()=>{
    const row=readSession(id,actor,eventId);
    if(row.result) return JSON.parse(row.result) as IngestResult;
    const upload=await store.getUpload(id);
    if(upload.offset!==row.bytes) throw new IngestError(409,'Transfer is incomplete. Resume uploading first.');
    const contract=JSON.parse(row.input) as Contract;
    let result:IngestResult;
    try { result=await ingestUpload({...contract,body:Readable.toWeb(store.read(id)) as UploadInput['body'],declaredBytes:row.bytes,expectedSha256:contract.sha256}); }
    catch(err) {
      if(err instanceof IngestError && err.status===422) {await store.remove(id).catch(()=>{});sqlite.prepare('DELETE FROM upload_sessions WHERE id=?').run(id);}
      throw err;
    }
    sqlite.prepare('UPDATE upload_sessions SET result=? WHERE id=?').run(JSON.stringify(result),id);
    // Receipt survives process/browser restart; original bytes now live in the immutable store.
    await store.remove(id).catch(()=>{});
    return result;
  });
}

export async function cleanExpiredTransfers() {
  const rows=sqlite.prepare('SELECT id FROM upload_sessions WHERE expires_at<?').all(nowIso()) as {id:string}[];
  for(const {id} of rows) await withStorageLock(`transfer:${id}`,async()=>{await store.remove(id).catch(()=>{});sqlite.prepare('DELETE FROM upload_sessions WHERE id=?').run(id);});
  // Remove orphaned files from a crash between file creation and DB insertion, after a grace day.
  for(const name of await fs.readdir(directory).catch(()=>[])) {
    const id=name.replace(/\.json$/,'');if(!/^[a-f0-9-]{36}$/.test(id)||sqlite.prepare('SELECT 1 FROM upload_sessions WHERE id=?').get(id))continue;
    const path=`${directory}/${name}`, st=await fs.stat(path).catch(()=>null);if(st&&Date.now()-st.mtimeMs>DAY)await fs.rm(path,{force:true});
  }
}
