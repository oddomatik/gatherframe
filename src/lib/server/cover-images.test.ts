import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { RequestEvent } from '@sveltejs/kit';
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  return { env:{dataDir:mkdtempSync(path.join(tmpdir(),'picture-day-cover-')),secret:'isolated-cover-secret'},nowIso:()=>new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default:Database }=await import('better-sqlite3'); const {drizzle}=await import('drizzle-orm/better-sqlite3');
  const schema=await import('./db/schema'); const {MIGRATIONS}=await import('./db/migrations');
  const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);
  return {sqlite,schema,db:drizzle(sqlite,{schema})};
});
vi.mock('./blob-store',()=>({materializeObject:vi.fn(),objectStat:vi.fn(),openObject:vi.fn()}));
import { db,schema,sqlite } from './db';
import { env } from './env';
import { coverImage,pruneCoverCache } from './cover-images';
import { materializeObject } from './blob-store';
import { mediaUrl, type MediaKind } from './media-access';
import { GET } from '../../routes/media/[photoId]/[kind]/+server';
const version='v2-'+'a'.repeat(64)+'-fixture';
let event:typeof schema.events.$inferSelect,photoId:number,source:Buffer;
const release=vi.fn(async()=>{});
function request(kind:MediaKind='cover960',headers={},method='GET',tokenKind=kind) {
 const url=new URL(mediaUrl(event,photoId,tokenKind,version),'https://fixture.invalid');
 return {url,params:{photoId:String(photoId),kind},locals:{},cookies:{get:()=>undefined},request:new Request(url,{method,headers})} as unknown as RequestEvent;
}
beforeEach(async()=>{
 vi.resetAllMocks();sqlite.exec('DELETE FROM events;');await fs.rm(env.dataDir,{force:true,recursive:true});await fs.mkdir(env.dataDir,{recursive:true});
 source=await sharp({create:{width:2560,height:1709,channels:3,background:'#597963'}}).withMetadata({exif:{IFD0:{Artist:'private-fixture'}}}).webp({quality:84}).toBuffer();
 const sourcePath=path.join(env.dataDir,'source.webp');await fs.writeFile(sourcePath,source);
 vi.mocked(materializeObject).mockResolvedValue({path:sourcePath,release});
 event=db.insert(schema.events).values({slug:'cover-fixture',name:'Fixture',variantPolicy:{},isPublished:1,createdAt:'now',updatedAt:'now'}).returning().get();
 const g=db.insert(schema.galleries).values({eventId:event.id,publicId:'visible',name:'Private label',createdAt:'now'}).returning().get();
 photoId=db.insert(schema.photos).values({galleryId:g.id,stem:'fixture',displayName:'Fixture',renditionHash:version,renditionStatus:'ready',createdAt:'now',updatedAt:'now'}).returning().get().id;
 db.insert(schema.galleryPhotos).values({galleryId:g.id,photoId}).run();
});
afterAll(async()=>{sqlite.close();await fs.rm(env.dataDir,{recursive:true,force:true});});
describe('responsive cover delivery',()=>{
 it('uses only the existing display rendition, compresses and preserves uncropped proportions and source bytes',async()=>{
  for(const [kind,width] of [['cover640',640],['cover960',960],['cover1440',1440]] as const){
   const r=await GET(request(kind));const bytes=Buffer.from(await r.arrayBuffer()),m=await sharp(bytes).metadata();
   expect(m).toMatchObject({format:'webp',width,height:Math.round(1709*width/2560)});expect(m.exif).toBeUndefined();expect(bytes.length).toBeLessThan(source.length);
  }
  expect(materializeObject).toHaveBeenCalledWith(`derivatives/${event.id}/${photoId}/${version}/web.webp`);
  expect(await fs.readFile(path.join(env.dataDir,'source.webp'))).toEqual(source);
  expect(db.select().from(schema.storageObjects).all()).toHaveLength(0);expect(release).toHaveBeenCalledTimes(3);
 });
 it('deduplicates concurrent cold generation and revalidates without opening remote source bytes',async()=>{
  const rs=await Promise.all(Array.from({length:4},()=>GET(request())));const bodies=await Promise.all(rs.map(async r=>Buffer.from(await r.arrayBuffer())));
  bodies.forEach(b=>expect(b).toEqual(bodies[0]));expect(materializeObject).toHaveBeenCalledTimes(1);
  const etag=rs[0].headers.get('etag')!;expect(rs[0].headers.get('cache-control')).toBe('private, no-cache');
  expect((await GET(request('cover960',{'if-none-match':etag}))).status).toBe(304);expect(materializeObject).toHaveBeenCalledTimes(1);
  const head=await GET(request('cover960',{},'HEAD'));expect(await head.text()).toBe('');expect(head.headers.get('content-length')).toBe(String(bodies[0].length));
 });
 it('rejects revoked publication, password, membership and wrong-kind claims even with cached bytes and ETags',async()=>{
  const r=await GET(request()),etag=r.headers.get('etag')!;await r.arrayBuffer();
  for(const change of ["UPDATE events SET is_published=0", "UPDATE events SET password_hash='new'", "UPDATE events SET expires_at='2000'", "UPDATE galleries SET is_archived=1", 'DELETE FROM gallery_photos']){
   sqlite.exec('SAVEPOINT revoke');sqlite.exec(change);
   await expect(GET(request('cover960',{'if-none-match':etag}))).rejects.toMatchObject({status:403});
   sqlite.exec('ROLLBACK TO revoke; RELEASE revoke');
  }
  await expect(GET(request('cover960',{},'GET','thumb'))).rejects.toMatchObject({status:403});expect(materializeObject).toHaveBeenCalledTimes(1);
 });
 it('changes cache identity on a new rendition and does not return the old conditional response',async()=>{
  const r=await GET(request()),etag=r.headers.get('etag')!;await r.arrayBuffer();
  sqlite.prepare('UPDATE photos SET rendition_hash=?').run('v2-'+'b'.repeat(64)+'-next');
  const replaced=await GET(request('cover960',{'if-none-match':etag}));expect(replaced.status).toBe(200);expect(replaced.headers.get('etag')).not.toBe(etag);expect(materializeObject).toHaveBeenCalledTimes(2);
 });
 it('handles small sources without enlargement and regenerates disposable cache without touching photo records',async()=>{
  const bytes=await sharp({create:{width:300,height:500,channels:3,background:'#456789'}}).webp().toBuffer();await fs.writeFile(path.join(env.dataDir,'source.webp'),bytes);
  const before=sqlite.prepare('SELECT * FROM photos').all();const result=await coverImage('existing.webp','cover640',true);expect(await sharp(result).metadata()).toMatchObject({width:300,height:500});
  for(const f of await fs.readdir(path.join(env.dataDir,'cache/covers')))await fs.utimes(path.join(env.dataDir,'cache/covers',f),0,0);
  await pruneCoverCache();expect(await fs.readdir(path.join(env.dataDir,'cache/covers'))).toHaveLength(0);
  expect(await coverImage('existing.webp','cover640',true)).toEqual(result);expect(sqlite.prepare('SELECT * FROM photos').all()).toEqual(before);
 });
 it('fails closed on missing source and bounds sizes to the supported variants',async()=>{
  vi.mocked(materializeObject).mockRejectedValue(new Error('private provider error'));
  await expect(GET(request())).rejects.toMatchObject({status:404});
  await expect(GET(request('cover999999' as MediaKind))).rejects.toMatchObject({status:404});
 });
});
