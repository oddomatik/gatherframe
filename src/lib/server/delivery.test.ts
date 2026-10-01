import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { env: { dataDir:mkdtempSync(join(tmpdir(),'gatherframe-versions-')), secret:'synthetic-versions-test', publicOrigin:'https://fixture.invalid', maxUploadBytes:2e7, maxZipPhotos:500 }, nowIso: () => new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema');
  const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON');
  for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db:drizzle(sqlite,{schema}) };
});
import { db, schema, sqlite } from './db';
import { MIGRATIONS } from './db/migrations';
import { env, nowIso } from './env';
import { storage } from './storage';
import * as blobs from './blob-store';
import { createEvent, getEvent, listEventPhotos } from './events';
import { createCollection } from './grouping';
import { ingestUpload, deletePhotoFile, type UploadInput } from './ingest';
import { shutdownImages } from './images';
import { renderDelivery, renderDeliveryJpeg } from './delivery-render';
import { currentFile, saveDeliveryVersion, listDeliveryVersions, requestGeneration, pauseDelivery, queueDeliveryBatch,
  backfillCandidates, fileIsCurrent, recipeHash, deliveryFilename, pausePendingDeliveries } from './delivery';
import { prepareTransfer } from './resumable';
import { DEFAULT_DELIVERY_RECIPE as recipe } from '$shared/delivery';
import { planImportFiles } from '$shared/import-plan';
import { publicPhotos } from './public';
import { grantEventAccess } from './access';
import { GET as fileGET } from '../../routes/g/[slug]/file/[fileId]/+server';
import { POST as zipPOST } from '../../routes/g/[slug]/api/zip/+server';
import { GET as zipGET } from '../../routes/g/[slug]/dl/[token]/+server';
import { deleteUnreferencedPath } from './workers';

let eventId: number, galleryId: number, cookies: Cookies;
const hash = (b:Buffer) => createHash('sha256').update(b).digest('hex');
beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec('DELETE FROM jobs; DELETE FROM events; DELETE FROM download_log; DELETE FROM download_tokens;');
  const event = createEvent({ name:'Versions fixture' }); eventId=event.id;
  db.update(schema.events).set({isPublished:1}).where(eq(schema.events.id,eventId)).run();
  galleryId=createCollection(eventId,'Visible collection');
  const values=new Map<string,string>([['pk_sid',`synthetic-visitor-${eventId}`]]);
  cookies={get:n=>values.get(n),set:(n,v)=>{values.set(n,v);},delete:n=>{values.delete(n);},getAll:()=>[...values].map(([name,value])=>({name,value})),serialize:(n,v)=>`${n}=${v}`};
  grantEventAccess(getEvent(eventId)!,values.get('pk_sid')!,cookies,true);
});
afterAll(async () => { await shutdownImages(); sqlite.close(); await fs.rm(env.dataDir,{recursive:true,force:true}); });
const jpeg=(color='#b4977a',width=1200,height=800)=>sharp({create:{width,height,channels:3,background:color}}).jpeg({quality:94}).toBuffer();
function upload(bytes:Buffer,extra:Partial<UploadInput>={}) {
  return ingestUpload({eventId,galleryId,filename:'IMG_0042.jpg',role:'print',body:Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,declaredBytes:bytes.length,...extra});
}
function configure(extra:Record<string,unknown>={}) {
  return saveDeliveryVersion(eventId,{key:'social',label:'Web',mode:'automatic',sourceRole:'print',recipe:{...recipe,width:640,height:640},access:'free',...extra});
}
function state(photoId:number,key='social') {
  return db.select().from(schema.deliveryStates).where(eq(schema.deliveryStates.photoId,photoId)).all().find(s=>s.role===key)!;
}
async function render(photoId:number,key='social') { await renderDelivery(eventId,photoId,key,state(photoId,key).generation); }
function ready(photoId:number) { db.update(schema.photos).set({renditionStatus:'ready'}).where(eq(schema.photos.id,photoId)).run(); }
function request(path:string,method='GET',body?:unknown,params:Record<string,string>={}) {
  const url=new URL(path,'https://fixture.invalid');
  return {url,params:{slug:getEvent(eventId)!.slug,...params},request:new Request(url,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),cookies,locals:{},getClientAddress:()=> '127.0.0.1'} as RequestEvent;
}

describe('delivery versions', () => {
  it('migrates legacy files without changing IDs, policies, hashes, memberships or bytes', () => {
    const legacy=new Database(':memory:'); legacy.pragma('foreign_keys=ON');
    for(const m of MIGRATIONS.slice(0,-1)) legacy.exec(m.sql);
    legacy.exec(`INSERT INTO events(id,slug,name,variant_policy,created_at,updated_at) VALUES(1,'old','Legacy','{"print":"disabled","social":"free","raw":"paid"}','old','old');
      INSERT INTO galleries(id,event_id,public_id,name,created_at) VALUES(1,1,'old','Collection','old');
      INSERT INTO photos(id,gallery_id,stem,display_name,created_at,updated_at) VALUES(7,1,'edit-2','Edit 2','old','old');
      INSERT INTO gallery_photos VALUES(1,7);
      INSERT INTO photo_files(id,photo_id,role,original_filename,ext,mime,bytes,sha256,storage_path,created_at) VALUES(31,7,'print','Edit-2.jpg','jpg','image/jpeg',111,'hash','originals/kept.jpg','old');`);
    const before=legacy.prepare('SELECT id,photo_id,role,original_filename,sha256,storage_path,bytes FROM photo_files').all();
    legacy.transaction(()=>legacy.exec(MIGRATIONS.at(-1)!.sql))();
    expect(legacy.prepare('SELECT id,photo_id,role,original_filename,sha256,storage_path,bytes FROM photo_files').all()).toEqual(before);
    expect(legacy.prepare('SELECT * FROM gallery_photos').all()).toEqual([{gallery_id:1,photo_id:7}]);
    expect(legacy.prepare('SELECT variant_policy FROM events').get()).toEqual({variant_policy:'{"print":"disabled","social":"free","raw":"paid"}'});
    expect(legacy.prepare('SELECT DISTINCT mode FROM delivery_versions').all()).toEqual([{mode:'uploaded'}]);
    expect(legacy.prepare('SELECT id,storage_path FROM photo_file_revisions').get()).toEqual({id:'legacy-31',storage_path:'originals/kept.jpg'});
    expect(legacy.prepare('SELECT status FROM delivery_states').get()).toEqual({status:'uploaded'});
    legacy.close();
  });

  it('preserves named Lightroom exports exactly and maps folders without merging distinct edits', async () => {
    const custom=saveDeliveryVersion(eventId,{label:'Client proof',mode:'uploaded',access:'free',filenameMode:'original',folder:'Proofs'});
    const bytes=await jpeg(); const master=await upload(bytes);
    const file=await upload(bytes,{role:custom.key as `v_${string}`});
    expect(file.photoId).toBe(master.photoId);
    expect(await fs.readFile(storage.abs(currentFile(file.photoId,custom.key)!.storagePath))).toEqual(bytes);
    expect(deliveryFilename(currentFile(file.photoId,custom.key)!,custom)).toBe('IMG_0042.jpg');
    const plan=planImportFiles([{name:'IMG_0042.jpg',webkitRelativePath:'Exports/Proofs/IMG_0042.jpg'},{name:'IMG_0042-Edit.jpg',webkitRelativePath:'Exports/Proofs/IMG_0042-Edit.jpg'}],null,'print',{'proofs':custom.key as `v_${string}`});
    expect(plan.size).toBe(2); expect(plan.get('img_0042')![0].role).toBe(custom.key);
    const renamed=saveDeliveryVersion(eventId,{key:custom.key,label:'Retouched proof',mode:'uploaded',access:'free'});
    expect(renamed.key).toBe(custom.key); expect(currentFile(file.photoId,custom.key)!.id).toBe(file.fileId);
    expect(listDeliveryVersions(eventId)).toHaveLength(4);
  });

  it('generates sRGB JPEGs with exact bounds, stripped metadata and unchanged private masters', async () => {
    configure();
    db.update(schema.events).set({variantPolicy:{print:'disabled',social:'free',raw:'disabled'}}).where(eq(schema.events.id,eventId)).run();
    const bytes=await sharp(await jpeg()).withExif({IFD0:{Artist:'Fixture artist',Copyright:'Fixture only'},IFD3:{GPSLatitudeRef:'N',GPSLatitude:'10/1 0/1 0/1'}}).jpeg().toBuffer();
    const original=await upload(bytes); await render(original.photoId); ready(original.photoId);
    const output=currentFile(original.photoId,'social')!, info=await sharp(storage.abs(output.storagePath)).metadata();
    expect(output).toMatchObject({origin:'generated',sourceFileId:original.fileId,sourceSha256:hash(bytes),width:640,height:427,available:1});
    expect(info.format).toBe('jpeg'); expect(info.space).toBe('srgb'); expect(info.icc?.length).toBeGreaterThan(0); expect(info.exif).toBeUndefined();
    expect(await fs.readFile(storage.abs(currentFile(original.photoId,'print')!.storagePath))).toEqual(bytes);
    const photos=publicPhotos(listEventPhotos(eventId),getEvent(eventId)!.variantPolicy,getEvent(eventId)!);
    expect(photos[0].files.map(f=>f.role)).toEqual(['social']);
    const response=await fileGET(request('/file', 'GET', undefined,{fileId:String(output.id)}));
    expect(hash(Buffer.from(await response.arrayBuffer()))).toBe(output.sha256);
    await expect(fileGET(request('/file','GET',undefined,{fileId:String(original.fileId)}))).rejects.toMatchObject({status:403});
  });

  it('respects orientation, rectangular bounds and no enlargement', async () => {
    configure({recipe:{...recipe,width:320,height:640}});
    const rotated=await sharp(await jpeg('#bb8866',1200,800)).withMetadata({orientation:6}).jpeg().toBuffer();
    const original=await upload(rotated); await render(original.photoId);
    expect(currentFile(original.photoId,'social')).toMatchObject({width:320,height:480});
    const small=await upload(await jpeg('#abc',100,50),{filename:'small.jpg'}); await render(small.photoId);
    expect(currentFile(small.photoId,'social')).toMatchObject({width:100,height:50});
  });

  it('keeps manual projects manual and makes backfill explicit and idempotent', async () => {
    const original=await upload(await jpeg());
    expect(currentFile(original.photoId,'social')).toBeUndefined();
    configure(); expect(currentFile(original.photoId,'social')).toBeUndefined();
    expect(backfillCandidates(eventId,'social').map(p=>p.photoId)).toEqual([original.photoId]);
    expect(queueDeliveryBatch(eventId,'social',[original.photoId])).toBe(1);
    expect(queueDeliveryBatch(eventId,'social',[original.photoId])).toBe(0);
    await render(original.photoId);
    const before=currentFile(original.photoId,'social')!;
    await render(original.photoId);
    expect(currentFile(original.photoId,'social')!.revisionId).toBe(before.revisionId);
    configure({recipe:{...recipe,width:800,height:800}});
    expect(currentFile(original.photoId,'social')!.sha256).toBe(before.sha256);
    expect(requestGeneration(eventId,original.photoId,'social')).toBe(true);
    expect(fileIsCurrent(currentFile(original.photoId,'social')!)).toBe(true);
    await render(original.photoId);
    expect(currentFile(original.photoId,'social')!.id).toBe(before.id);
    expect(currentFile(original.photoId,'social')!.recipeHash).toBe(recipeHash({...recipe,width:800,height:800}));
  });

  it('an authored override wins against a render already in flight', async () => {
    configure(); const original=await upload(await jpeg());
    const materialize=blobs.materializeObject; let release!:()=>void, entered!:()=>void;
    const started=new Promise<void>(r=>entered=r), gate=new Promise<void>(r=>release=r);
    vi.spyOn(blobs,'materializeObject').mockImplementationOnce(async path=>{entered();await gate;return materialize(path);});
    const job=render(original.photoId); await started;
    const custom=await jpeg('#445566',700,500); await upload(custom,{role:'social'});
    release(); await job;
    expect(currentFile(original.photoId,'social')).toMatchObject({origin:'uploaded',sha256:hash(custom)});
    expect(state(original.photoId).status).toBe('uploaded');
    expect(requestGeneration(eventId,original.photoId,'social')).toBe(false);
  });

  it('source changes invalidate old downloads and fence an older job without changing memberships', async () => {
    configure(); const original=await upload(await jpeg()); await render(original.photoId); ready(original.photoId);
    const previous=currentFile(original.photoId,'social')!;
    const tokenResponse=await zipPOST(request('/zip','POST',{photoIds:[original.photoId],roles:['social']}));
    const {url}=await tokenResponse.json();
    const groups=sqlite.prepare('SELECT * FROM gallery_photos').all();
    await upload(await jpeg('#eecc99'),{replacement:'replace'});
    expect(fileIsCurrent(currentFile(original.photoId,'social')!)).toBe(false);
    ready(original.photoId);
    await expect(fileGET(request('/file','GET',undefined,{fileId:String(previous.id)}))).rejects.toMatchObject({status:409});
    await expect(zipGET(request(url,'GET',undefined,{token:url.split('/').at(-1)}))).rejects.toMatchObject({status:409});
    const materialize=blobs.materializeObject; let release!:()=>void, entered!:()=>void;
    const started=new Promise<void>(r=>entered=r), gate=new Promise<void>(r=>release=r);
    vi.spyOn(blobs,'materializeObject').mockImplementationOnce(async path=>{entered();await gate;return materialize(path);});
    const oldJob=render(original.photoId); await started;
    const newest=await jpeg('#112233'); await upload(newest,{replacement:'replace'}); const latestGeneration=state(original.photoId).generation;
    release(); await oldJob;
    expect(state(original.photoId).generation).toBe(latestGeneration); expect(state(original.photoId).status).toBe('queued');
    await render(original.photoId);
    expect(currentFile(original.photoId,'social')!.sourceSha256).toBe(hash(newest));
    expect(sqlite.prepare('SELECT * FROM gallery_photos').all()).toEqual(groups);
    expect(await deleteUnreferencedPath(previous.storagePath)).toBe(false);
  });

  it('retains authored companions for review and requires exact consent to resume an override', async () => {
    configure(); const original=await upload(await jpeg());
    const custom=await jpeg('#456',900,600); await upload(custom,{role:'social'});
    await upload(await jpeg('#765'),{replacement:'replace'});
    expect(currentFile(original.photoId,'social')).toMatchObject({origin:'uploaded',sha256:hash(custom),needsReview:1});
    expect(requestGeneration(eventId,original.photoId,'social',{resume:true,replaceUploadSha256:'wrong'})).toBe(false);
    expect(requestGeneration(eventId,original.photoId,'social',{resume:true,replaceUploadSha256:hash(custom)})).toBe(true);
    await render(original.photoId);
    expect(currentFile(original.photoId,'social')!.origin).toBe('generated');
    expect(sqlite.prepare('SELECT count(*) n FROM photo_file_revisions WHERE sha256=?').get(hash(custom))).toMatchObject({n:1});
  });

  it('pauses and deletes without accidental regeneration, then resumes only on request', async () => {
    configure(); const original=await upload(await jpeg()); const generation=state(original.photoId).generation;
    pauseDelivery(eventId,original.photoId,'social');
    await renderDelivery(eventId,original.photoId,'social',generation); expect(currentFile(original.photoId,'social')).toBeUndefined();
    await upload(await jpeg('#987'),{replacement:'replace'}); expect(state(original.photoId).status).toBe('paused');
    expect(requestGeneration(eventId,original.photoId,'social',{resume:true})).toBe(true); await render(original.photoId);
    await deletePhotoFile(currentFile(original.photoId,'social')!.id);
    expect(state(original.photoId).status).toBe('paused'); expect(requestGeneration(eventId,original.photoId,'social')).toBe(false);
  });

  it('rejects generated-source chains, cross-project IDs and missing ZIP versions', async () => {
    configure();
    expect(()=>saveDeliveryVersion(eventId,{label:'Chained',mode:'automatic',sourceRole:'social'})).toThrow('uploaded finished');
    const custom=saveDeliveryVersion(eventId,{label:'Proof',mode:'uploaded'});
    const original=await upload(await jpeg()); ready(original.photoId);
    await expect(zipPOST(request('/zip','POST',{photoIds:[original.photoId],roles:['print','social']}))).rejects.toMatchObject({status:409});
    const other=createEvent({name:'Other'});
    expect(()=>requestGeneration(other.id,original.photoId,'social')).toThrow('not found');
    await expect(upload(await jpeg(),{eventId:other.id,role:custom.key as `v_${string}`})).rejects.toMatchObject({status:404});
  });

  it('recovers an interrupted processing state and does not publish unsupported sources', async () => {
    configure(); const original=await upload(await jpeg());
    sqlite.prepare("UPDATE delivery_states SET status='processing' WHERE photo_id=? AND role='social'").run(original.photoId);
    await render(original.photoId); expect(state(original.photoId).status).toBe('ready');
    const png=await sharp(await jpeg()).png().toBuffer(); const bad=await upload(png,{filename:'unsupported.png'});
    await expect(render(bad.photoId)).rejects.toThrow('conventional SDR JPEG');
    expect(state(bad.photoId).status).toBe('failed'); expect(currentFile(bad.photoId,'social')).toBeUndefined();
  });

  it('delivers a named version in a ZIP and counts it without treating it as RAW', async () => {
    const custom=saveDeliveryVersion(eventId,{label:'Client proof',mode:'uploaded',access:'free',filenameMode:'original'});
    const original=await upload(await jpeg()); await upload(await jpeg('#ab8765',500,300),{role:custom.key as `v_${string}`}); ready(original.photoId);
    const response=await zipPOST(request('/zip','POST',{photoIds:[original.photoId],roles:[custom.key]}));
    const {url}=await response.json();
    const zip=await zipGET(request(url,'GET',undefined,{token:url.split('/').at(-1)}));
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(Buffer.from(await zip.arrayBuffer()).includes(Buffer.from('IMG_0042.jpg'))).toBe(true);
    expect(sqlite.prepare("SELECT other_files,raw_files FROM guest_activity WHERE kind='download_complete' AND event_id=?").get(eventId)).toEqual({other_files:1,raw_files:0});
  });

  it('rechecks a generated download after a source change during storage preflight', async () => {
    configure(); const original=await upload(await jpeg()); await render(original.photoId); ready(original.photoId);
    const file=currentFile(original.photoId,'social')!, stat=blobs.objectStat;
    vi.spyOn(blobs,'objectStat').mockImplementationOnce(async path=>{
      const result=await stat(path); await upload(await jpeg('#884455'),{replacement:'replace'}); ready(original.photoId); return result;
    });
    await expect(fileGET(request('/file','GET',undefined,{fileId:String(file.id)}))).rejects.toMatchObject({status:409});
  });

  it('a preflighted upload to an empty slot can supersede a generated copy that arrives first', async () => {
    configure(); const original=await upload(await jpeg()); await render(original.photoId);
    const custom=await jpeg('#112233',400,300);
    await upload(custom,{role:'social',expectedPhotoId:original.photoId,expectedVersion:null});
    expect(currentFile(original.photoId,'social')).toMatchObject({origin:'uploaded',sha256:hash(custom)});
  });

  it('allowlists copyright metadata without copying private EXIF', async () => {
    const input=storage.abs(storage.tmp('metadata-source.jpg')), output=storage.abs(storage.tmp('metadata-output.jpg'));
    await fs.mkdir(storage.abs('tmp'),{recursive:true});
    await sharp(await jpeg()).withExif({IFD0:{Artist:'Fixture creator',Copyright:'Synthetic fixture',ImageDescription:'Private note'}}).jpeg().toFile(input);
    await renderDeliveryJpeg(input,{...recipe,metadata:'copyright'},output);
    const {exiftool}=await import('exiftool-vendored'); const tags=await exiftool.read(output);
    expect(tags.Artist).toBe('Fixture creator'); expect(tags.Copyright).toBe('Synthetic fixture'); expect(tags.ImageDescription).toBeUndefined(); expect(tags.GPSLatitude).toBeUndefined();
  });

  it('byte-identical resumable uploads cancel consent for an in-flight automatic replacement', async () => {
    configure(); const original=await upload(await jpeg()); const custom=await jpeg('#123',500,300);
    await upload(custom,{role:'social'});
    expect(requestGeneration(eventId,original.photoId,'social',{resume:true,replaceUploadSha256:hash(custom)})).toBe(true);
    const generation=state(original.photoId).generation;
    const result=await prepareTransfer(eventId,1,{galleryId,filename:'IMG_0042.jpg',role:'social',bytes:custom.length,sha256:hash(custom)});
    expect(result).toHaveProperty('result.status','unchanged');
    await renderDelivery(eventId,original.photoId,'social',generation);
    expect(currentFile(original.photoId,'social')).toMatchObject({origin:'uploaded',sha256:hash(custom)});
    expect(state(original.photoId).status).toBe('uploaded');
  });

  it('bulk pause is scoped to a project and fences all pending copies', async () => {
    configure(); const first=await upload(await jpeg()), second=await upload(await jpeg('#345'),{filename:'second.jpg'});
    const other=createEvent({name:'Other project'});
    expect(pausePendingDeliveries(other.id,'social')).toBe(0);
    expect(pausePendingDeliveries(eventId,'social')).toBe(2);
    expect(state(first.photoId).status).toBe('paused'); expect(state(second.photoId).status).toBe('paused');
    await render(first.photoId); await render(second.photoId);
    expect(currentFile(first.photoId,'social')).toBeUndefined();expect(currentFile(second.photoId,'social')).toBeUndefined();
  });
});
