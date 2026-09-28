import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
vi.mock('./env', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  return { env: { dataDir: mkdtempSync(path.join(tmpdir(), 'picture-day-sharing-')), secret: 'isolated-sharing', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() };
});
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3'); const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema'); const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
import { db, sqlite, schema } from './db';
import { env } from './env';
import { createEvent, getEvent, updateEvent } from './events';
import { ensureIntake, createCollection } from './grouping';
import { linkPreview, renderLinkPreview, readShareForm, saveLinkPreview, SHARE_UPLOAD_LIMIT } from './link-preview';
import { storage } from './storage';
import { GET } from '../../routes/share/[slug]/[image]/+server';
let eventId: number, intake: number, group: number, photo: number;
const event = () => getEvent(eventId)!;
const form = (mode: string, extra: Record<string,string> = {}) => { const f = new FormData(); f.set('mode',mode); for (const [k,v] of Object.entries(extra)) f.set(k,v); return f; };
const fetchPreview = (revision = linkPreview(event()).revision, headers = {}, method = 'GET') => (GET as Function)({ params: { slug: event().slug, image: `${revision}.jpg` }, locals: { admin: {id: 1} }, request: new Request('https://fixture.invalid/share/image', { method, headers }) });
const jpeg = () => sharp({create:{width:80,height:60,channels:3,background:'#dd4433'}}).jpeg().toBuffer();
beforeEach(async () => {
  vi.stubEnv('STORAGE_SKIP_SPACE_CHECK','1'); sqlite.exec('DELETE FROM events; DELETE FROM storage_objects; DELETE FROM settings');
  await fs.rm(env.dataDir, { recursive:true, force:true }); await fs.mkdir(storage.abs('tmp'),{recursive:true});
  eventId = createEvent({name:'Group & friends <2026>'}).id; intake = ensureIntake(eventId); group = createCollection(eventId,'Group');
  photo = db.insert(schema.photos).values({galleryId:intake,stem:'shot1',displayName:'shot1',renditionStatus:'ready',createdAt:'2026-09-27',updatedAt:'2026-09-27'}).returning().get().id;
  db.insert(schema.galleryPhotos).values({galleryId:group,photoId:photo}).run();
  const dest = storage.abs(storage.derivative(eventId,photo,'preview')); await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.writeFile(dest,await jpeg());
});
afterAll(async()=>{vi.unstubAllEnvs();sqlite.close();await fs.rm(env.dataDir,{recursive:true,force:true});});
describe('project link previews',()=>{
  it('defaults to an escaped title card and never chooses an arbitrary child',async()=>{
    expect(linkPreview(event()).kind).toBe('title');
    expect(await sharp(await renderLinkPreview(event())).metadata()).toMatchObject({format:'jpeg',width:1200,height:630});
    updateEvent(eventId,{name:'W'.repeat(150)});
    expect(await sharp(await renderLinkPreview(event())).metadata()).toMatchObject({width:1200,height:630});
  });
  it('selects a project photo without changing photo identity, memberships or collection covers',async()=>{
    const before=Object.fromEntries(['photos','gallery_photos','galleries','photo_files'].map(t=>[t,sqlite.prepare(`SELECT * FROM ${t}`).all()]));
    await saveLinkPreview(eventId,form('photo',{photoId:String(photo)}));
    expect(linkPreview(event()).kind).toBe('photo');
    expect(await sharp(await renderLinkPreview(event())).metadata()).toMatchObject({width:1200,height:630});
    for(const t of Object.keys(before))expect(sqlite.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[t]);
    await saveLinkPreview(eventId,form('title'));expect(event().sharePhotoId).toBeNull();
  });
  it('rejects foreign, intake-only, archived and pending photos, retaining the previous choice',async()=>{
    for(const change of ["UPDATE galleries SET is_archived=1 WHERE is_intake=0", "UPDATE galleries SET is_intake=1 WHERE is_intake=0", "UPDATE photos SET rendition_status='pending'"]) {
      const before=sqlite.prepare('SELECT * FROM galleries').all();
      sqlite.exec('SAVEPOINT scenario');sqlite.exec(change);
      await expect(saveLinkPreview(eventId,form('photo',{photoId:String(photo)}))).rejects.toMatchObject({status:400});
      sqlite.exec('ROLLBACK TO scenario; RELEASE scenario');expect(sqlite.prepare('SELECT * FROM galleries').all()).toEqual(before);
    }
    const other=createEvent({name:'Other'});
    await expect(saveLinkPreview(other.id,form('photo',{photoId:String(photo)}))).rejects.toMatchObject({status:400});
    expect(getEvent(other.id)?.sharePhotoId).toBeNull();
  });
  it('changes URLs after replacement and falls back safely when the selected photo is no longer shared',async()=>{
    await saveLinkPreview(eventId,form('photo',{photoId:String(photo)}));const old=linkPreview(event());
    sqlite.prepare('UPDATE photos SET rendition_hash=? WHERE id=?').run('v2-'+'a'.repeat(64)+'-new',photo);
    expect(linkPreview(event()).revision).not.toBe(old.revision);
    sqlite.prepare('DELETE FROM gallery_photos WHERE photo_id=?').run(photo);
    expect(linkPreview(event()).kind).toBe('title');expect(event().sharePhotoId).toBe(photo);
  });
  it('normalizes uploaded art, strips metadata and keeps it separate from catalog photos',async()=>{
    const input=await sharp(await jpeg()).withMetadata({exif:{IFD0:{Artist:'PRIVATE TEST'}}}).png().toBuffer();
    const f=form('upload');f.set('image',new Blob([new Uint8Array(input)],{type:'image/png'}),'art.png');await saveLinkPreview(eventId,f);
    expect(linkPreview(event()).kind).toBe('upload');expect(event().sharePhotoId).toBeNull();
    const bytes=await fs.readFile(storage.abs(linkPreview(event()).source!));
    const meta=await sharp(bytes).metadata();expect(meta).toMatchObject({format:'jpeg',width:1200,height:630});expect(meta.exif).toBeUndefined();
    expect(sqlite.prepare('SELECT count(*) n FROM photos').get()).toEqual({n:1});
    const hash=event().shareUploadHash;
    for(const input of ['bad image','<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>']){
      const invalid=form('upload');invalid.set('image',new Blob([input]),'bad.png');
      await expect(saveLinkPreview(eventId,invalid)).rejects.toMatchObject({status:400});expect(event().shareUploadHash).toBe(hash);
    }
  });
  it('enforces body limits even without a truthful Content-Length',async()=>{
    const good=form('title');expect((await readShareForm(new Request('https://fixture.invalid',{method:'POST',body:good}))).get('mode')).toBe('title');
    await expect(readShareForm(new Request('https://fixture.invalid',{method:'POST',headers:{'content-length':String(SHARE_UPLOAD_LIMIT*2)},body:'small'}))).rejects.toMatchObject({status:413});
    await expect(readShareForm(new Request('https://fixture.invalid',{method:'POST',headers:{'content-length':'1'},body:new Uint8Array(SHARE_UPLOAD_LIMIT+65537)}))).rejects.toMatchObject({status:413});
  });
  it('makes only the chosen card public and revokes old/expired/unpublished URLs before cache validation',async()=>{
    await expect(fetchPreview()).rejects.toMatchObject({status:404});
    updateEvent(eventId,{isPublished:1,passwordHash:'locked'});
    const first=await fetchPreview();expect(first.status).toBe(200);expect(first.headers.get('content-type')).toBe('image/jpeg');
    const etag=first.headers.get('etag');expect((await fetchPreview(undefined,{'if-none-match':etag})).status).toBe(304);
    expect((await fetchPreview(undefined,{},'HEAD')).body).toBeNull();
    const old=linkPreview(event()).revision;await saveLinkPreview(eventId,form('photo',{photoId:String(photo)}));
    await expect(fetchPreview(old,{'if-none-match':etag})).rejects.toMatchObject({status:404});
    updateEvent(eventId,{expiresAt:'2000-01-01'});await expect(fetchPreview()).rejects.toMatchObject({status:404});
    updateEvent(eventId,{expiresAt:null,isPublished:0});await expect(fetchPreview()).rejects.toMatchObject({status:404});
  });
});
