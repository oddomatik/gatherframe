import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./env', () => ({ env: { secret: 'isolated-cover-test', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema'); const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) sqlite.exec(m.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
import Database from 'better-sqlite3';
import { db, schema, sqlite } from './db';
import { MIGRATIONS } from './db/migrations';
import { createEvent, getEvent, listGalleries, setGalleryCover, updateEvent } from './events';
import { createCollection, ensureIntake } from './grouping';
import { publicGalleries } from './public';
import { actions } from '../../routes/admin/events/[id]/+page.server';

let eventId:number,a:number,b:number,intake:number,archived:number,shared:number,two:number,ten:number,four:number,pending:number;
function photo(stem:string,collections:number[],ready=true) {
  const id=db.insert(schema.photos).values({galleryId:intake,stem,displayName:stem,renditionStatus:ready?'ready':'pending',createdAt:'2026-09-26',updatedAt:'2026-09-26'}).returning().get().id;
  for(const galleryId of collections) db.insert(schema.galleryPhotos).values({galleryId,photoId:id}).run();
  return id;
}
const owner=()=>listGalleries(eventId);
const parents=(matching?:Set<number>)=>publicGalleries(owner(),getEvent(eventId)!,null,matching);
const cover=(rows:{id:number;coverThumbId:number|null}[],id:number)=>rows.find(g=>g.id===id)?.coverThumbId;
function action(name:'setCover'|'update',values:Record<string,string>,admin=true) {
  return (actions[name] as Function)({params:{id:String(eventId)},locals:admin?{admin:{id:1}}:{},request:new Request('https://fixture.invalid',{method:'POST',body:new URLSearchParams(values)})});
}
beforeEach(()=>{
  sqlite.exec('DELETE FROM events'); eventId=createEvent({name:'Child covers'}).id;
  intake=ensureIntake(eventId);a=createCollection(eventId,'Child A');b=createCollection(eventId,'Child B');archived=createCollection(eventId,'Archived');
  sqlite.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(archived);
  shared=photo('SHOT_1',[a,b]); ten=photo('SHOT_10',[a]); two=photo('SHOT_2',[a,intake,archived]); four=photo('SHOT_4',[b]); pending=photo('SHOT_0',[a],false);
});
afterAll(()=>sqlite.close());
describe('child collection covers',()=>{
  it('prefers exclusive ready photos in natural shot order in owner and parent tiles without editing memberships',()=>{
    const before=sqlite.prepare('SELECT * FROM gallery_photos ORDER BY gallery_id,photo_id').all();
    expect(getEvent(eventId)?.collectionCoverPolicy).toBe('exclusive');
    for(const rows of [owner(),parents()]) {expect(cover(rows,a)).toBe(two);expect(cover(rows,b)).toBe(four);}
    expect(sqlite.prepare('SELECT * FROM gallery_photos ORDER BY gallery_id,photo_id').all()).toEqual(before);
    expect(owner().find(g=>g.id===a)?.coverPhotoId).toBeNull();
  });
  it('keeps an explicit shared-photo pin ahead of the preference, and supports returning to automatic',async()=>{
    await action('setCover',{galleryId:String(a),photoId:String(shared)});
    expect(cover(owner(),a)).toBe(shared);expect(cover(parents(),a)).toBe(shared);
    await action('setCover',{galleryId:String(a),photoId:''});
    expect(cover(owner(),a)).toBe(two);expect(owner().find(g=>g.id===a)?.coverPhotoId).toBeNull();
  });
  it('evaluates sharing across the whole project, but chooses only within the authorized filtered set',()=>{
    setGalleryCover(a,two);
    expect(cover(parents(new Set([shared,ten])),a)).toBe(ten);
    expect(cover(parents(new Set([shared])),a)).toBe(shared);
    expect(cover(parents(new Set([pending])),a)).toBeUndefined();
    const aOnly=owner().filter(g=>g.id===a);
    expect(cover(publicGalleries(aOnly,getEvent(eventId)!,null,new Set([shared,ten])),a)).toBe(ten);
    expect(owner().find(g=>g.id===a)?.coverPhotoId).toBe(two);
  });
  it('reacts to new sharing, falls back for all-shared collections, and ignores archived child collections',()=>{
    for(const id of [two,ten])db.insert(schema.galleryPhotos).values({galleryId:b,photoId:id}).run();
    expect(cover(owner(),a)).toBe(shared);
    sqlite.prepare('DELETE FROM gallery_photos WHERE gallery_id=? AND photo_id=?').run(b,ten);
    expect(cover(parents(),a)).toBe(ten);
    sqlite.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(b);
    expect(cover(owner(),a)).toBe(shared);
    sqlite.prepare('UPDATE galleries SET is_archived=0 WHERE id=?').run(b);
    expect(cover(owner(),a)).toBe(ten);
  });
  it('configures each project separately and keeps manual overrides when changing the project rule',async()=>{
    const other=createEvent({name:'Independent'});
    await action('update',{collectionCoverPolicy:'first'});
    expect(cover(owner(),a)).toBe(shared);expect(cover(parents(),b)).toBe(shared);
    expect(getEvent(other.id)?.collectionCoverPolicy).toBe('exclusive');
    setGalleryCover(a,ten);updateEvent(eventId,{collectionCoverPolicy:'exclusive'});
    expect(cover(owner(),a)).toBe(ten);
    await action('update',{name:'Old form without new setting'});
    expect(getEvent(eventId)?.collectionCoverPolicy).toBe('exclusive');
    expect(await action('update',{collectionCoverPolicy:'invented'})).toMatchObject({status:400});
    expect(getEvent(eventId)?.collectionCoverPolicy).toBe('exclusive');
  });
  it('does not silently clear a pin on malformed, foreign, unfinished, intake, or unauthorized requests',async()=>{
    setGalleryCover(a,shared);
    for(const photoId of ['invalid','0',String(four),String(pending)])expect(await action('setCover',{galleryId:String(a),photoId})).toMatchObject({status:400});
    expect(await action('setCover',{galleryId:String(a)})).toMatchObject({status:400});
    expect(await action('setCover',{galleryId:String(intake),photoId:String(two)})).toMatchObject({status:400});
    const other=createCollection(createEvent({name:'Other'}).id);
    await expect(action('setCover',{galleryId:String(other),photoId:''})).rejects.toMatchObject({status:404});
    await expect(action('setCover',{galleryId:String(a),photoId:''},false)).rejects.toMatchObject({status:401});
    expect(owner().find(g=>g.id===a)?.coverPhotoId).toBe(shared);
  });
  it('temporarily falls back if a pinned rendition is pending without discarding the pin',()=>{
    setGalleryCover(a,shared);sqlite.prepare("UPDATE photos SET rendition_status='pending' WHERE id=?").run(shared);
    expect(cover(owner(),a)).toBe(two);expect(cover(parents(),a)).toBe(two);
    expect(owner().find(g=>g.id===a)?.coverPhotoId).toBe(shared);
    sqlite.prepare("UPDATE photos SET rendition_status='ready' WHERE id=?").run(shared);
    expect(cover(owner(),a)).toBe(shared);
  });
  it('migrates existing projects without rewriting pinned covers or any existing event/photo/membership fields',()=>{
    const fixture=new Database(':memory:');
    try {
      for(const m of MIGRATIONS.filter(m=>m.id!=='0009_collection_cover_policy'))fixture.exec(m.sql);
      fixture.exec("INSERT INTO events(id,slug,name,variant_policy,created_at,updated_at) VALUES(1,'fixture','Existing','{}','before','before'); INSERT INTO galleries(id,event_id,public_id,name,cover_photo_id,created_at) VALUES(1,1,'child','Existing child',1,'before'); INSERT INTO photos(id,gallery_id,stem,display_name,created_at,updated_at) VALUES(1,1,'shot1','shot1','before','before'); INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(1,1);");
      const names=['events','galleries','photos','gallery_photos'];
      const before=Object.fromEntries(names.map(name=>[name,fixture.prepare(`SELECT * FROM ${name}`).all()]));
      fixture.exec(MIGRATIONS.find(m=>m.id==='0009_collection_cover_policy')!.sql);
      for(const name of names) {
        const columns=Object.keys((before[name] as Record<string,unknown>[])[0]);
        expect(fixture.prepare(`SELECT ${columns.join(',')} FROM ${name}`).all()).toEqual(before[name]);
      }
      expect(fixture.prepare('SELECT collection_cover_policy policy FROM events').get()).toEqual({policy:'exclusive'});
    } finally {fixture.close();}
  });
});
