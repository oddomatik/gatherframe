import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./env', () => ({ env:{secret:'presentation-test',publicOrigin:'https://fixture.invalid'}, nowIso:()=>new Date().toISOString() }));
vi.mock('./db', async () => {
  const {default:Database}=await import('better-sqlite3');
  const {drizzle}=await import('drizzle-orm/better-sqlite3');
  const schema=await import('./db/schema'), {MIGRATIONS}=await import('./db/migrations');
  const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys = ON');
  for(const m of MIGRATIONS)sqlite.exec(m.sql);
  return {sqlite,schema,db:drizzle(sqlite,{schema})};
});
import Database from 'better-sqlite3';
import {db,schema,sqlite} from './db';
import {MIGRATIONS} from './db/migrations';
import {createEvent,getEvent,listGalleries,listPhotos,listEventPhotos,updateEvent} from './events';
import {createCollection,ensureIntake,addPhotosToCollections,archiveCollection} from './grouping';
import {saveGalleryLayout,savePublicCollection,saveCollectionSequence,saveCollectionSequenceOrder} from './presentation';
import {publicGalleries,publicPhotos} from './public';
import {visibleEventPhotos,browseTags} from './tag-browsing';
import {actions} from '../../routes/admin/events/[id]/+page.server';

let project:number,a:number,b:number,tray:number,first:number,second:number,third:number,hidden:number;
function photo(stem:string,collections:number[]) {
  const id=db.insert(schema.photos).values({galleryId:tray,stem,displayName:stem,renditionStatus:'ready',createdAt:'fixture',updatedAt:'fixture'}).returning().get().id;
  for(const galleryId of collections)db.insert(schema.galleryPhotos).values({galleryId,photoId:id}).run();
  return id;
}
const sequence=(id:number)=>listPhotos(id).map(p=>p.id);
beforeEach(()=>{
  sqlite.exec('DELETE FROM events');project=createEvent({name:'Photographer fixture'}).id;
  tray=ensureIntake(project);a=createCollection(project,'SECRET household');b=createCollection(project,'PRIVATE selects');
  first=photo('frame1',[a,b]);second=photo('frame2',[a]);third=photo('frame3',[a,b]);hidden=photo('hidden',[tray]);
});
afterAll(()=>sqlite.close());

describe('compatible project presentation',()=>{
  it('adds anonymous directory defaults without changing legacy data, references or membership',()=>{
    const fixture=new Database(':memory:');
    try {
      for(const m of MIGRATIONS.filter(m=>m.id!=='0016_gallery_presentation'))fixture.exec(m.sql);
      fixture.exec("INSERT INTO events(id,slug,name,variant_policy,is_published,created_at,updated_at) VALUES(1,'old','Old','{}',1,'old','old'); INSERT INTO galleries(id,event_id,public_id,name,created_at) VALUES(1,1,'old-set','PRIVATE','old'); INSERT INTO photos(id,gallery_id,stem,display_name,created_at,updated_at) VALUES(1,1,'original','original','old','old'); INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(1,1);");
      const tables=['events','galleries','photos','gallery_photos'];
      const before=new Map(tables.map(t=>[t,fixture.prepare(`SELECT * FROM ${t}`).all() as Record<string,unknown>[]]));
      fixture.exec(MIGRATIONS.find(m=>m.id==='0016_gallery_presentation')!.sql);
      for(const table of tables)expect(fixture.prepare(`SELECT ${Object.keys(before.get(table)![0]).join(',')} FROM ${table}`).all()).toEqual(before.get(table));
      expect(fixture.prepare('SELECT gallery_layout FROM events').get()).toEqual({gallery_layout:'directory'});
      expect(fixture.prepare('SELECT public_title,public_description FROM galleries').get()).toEqual({public_title:null,public_description:null});
      expect(fixture.prepare('SELECT position FROM gallery_photos').get()).toEqual({position:null});
    } finally {fixture.close();}
  });
  it('changes layout only, leaving publication, access, sales and private intake unchanged',()=>{
    updateEvent(project,{orderingEnabled:0,passwordHash:'private-hash',isPublished:0});
    const before=getEvent(project)!;
    for(const layout of ['simple','sections','directory']) {
      saveGalleryLayout(project,layout);
      const after=getEvent(project)!;
      expect({...after,galleryLayout:before.galleryLayout,updatedAt:before.updatedAt}).toEqual(before);
      expect(visibleEventPhotos(after).map(p=>p.id)).not.toContain(hidden);
    }
    expect(()=>saveGalleryLayout(project,'invented')).toThrow();
  });
  it('publishes only explicitly entered public text, never internal names',()=>{
    const event=getEvent(project)!;
    expect(JSON.stringify(publicGalleries(listGalleries(project),event))).not.toMatch(/SECRET|PRIVATE/);
    savePublicCollection(project,a,'The ceremony','A public introduction');
    const guest=publicGalleries(listGalleries(project),event);
    expect(guest.find(g=>g.id===a)).toMatchObject({publicTitle:'The ceremony',publicDescription:'A public introduction'});
    expect(JSON.stringify(guest)).not.toMatch(/SECRET|PRIVATE/);
    expect(listGalleries(project).find(g=>g.id===a)?.name).toBe('SECRET household');
    savePublicCollection(project,a,'','');
    expect(publicGalleries(listGalleries(project),event).find(g=>g.id===a)?.publicTitle).toBeNull();
  });
  it('rejects foreign, archived, intake and oversized public edits',()=>{
    const foreign=createCollection(createEvent({name:'Other'}).id);
    for(const gallery of [foreign,tray])expect(()=>savePublicCollection(project,gallery,'Title','')).toThrow();
    archiveCollection(project,b);
    expect(()=>savePublicCollection(project,b,'Title','')).toThrow();
    expect(()=>savePublicCollection(project,a,'x'.repeat(121),'')).toThrow();
    expect(()=>savePublicCollection(project,a,'Title','x'.repeat(2001))).toThrow();
  });
  it('keeps independent collection order, canonical identity and project-wide order',()=>{
    const originalPhotos=sqlite.prepare('SELECT * FROM photos ORDER BY id').all();
    saveCollectionSequence(project,a,[third,first,second],sequence(a));
    expect(sequence(a)).toEqual([third,first,second]);expect(sequence(b)).toEqual([first,third]);
    expect(listEventPhotos(project).filter(p=>p.id!==hidden).map(p=>p.id)).toEqual([first,second,third]);
    expect(sqlite.prepare('SELECT * FROM photos ORDER BY id').all()).toEqual(originalPhotos);
    const event=getEvent(project)!;
    expect(publicGalleries(listGalleries(project),event).find(g=>g.id===a)?.photoIds).toEqual([third,first,second]);
    expect(publicPhotos(listPhotos(a),event.variantPolicy,event).map(p=>p.id)).toEqual([third,first,second]);
    saveCollectionSequence(project,a,sequence(a),sequence(a),true);expect(sequence(a)).toEqual([first,second,third]);
  });
  it('preserves custom ordering when adding a photo and rejects stale or incomplete updates atomically',()=>{
    const old=sequence(a);saveCollectionSequence(project,a,[third,first,second],old);
    expect(()=>saveCollectionSequence(project,a,old,old)).toThrow(/changed/);
    expect(()=>saveCollectionSequence(project,a,[first,first,second],sequence(a))).toThrow();
    expect(()=>saveCollectionSequence(project,a,[first,second],sequence(a))).toThrow();
    expect(()=>saveCollectionSequence(project,a,[first,second,hidden],sequence(a))).toThrow();
    addPhotosToCollections(project,[hidden],[a]);expect(sequence(a)).toEqual([third,first,second,hidden]);
    expect(sequence(b)).toEqual([first,third]);
  });
  it('applies collection sequence while filtering photos without exposing empty/private content',()=>{
    saveCollectionSequenceOrder(project,[b,a],[a,b]);
    expect(publicGalleries(listGalleries(project),getEvent(project)!).map(g=>g.id)).toEqual([b,a]);
    expect(()=>saveCollectionSequenceOrder(project,[a,b],[a,b])).toThrow(/changed/);
    expect(publicGalleries(listGalleries(project),getEvent(project)!,null,new Set([second])).map(g=>g.id)).toEqual([a]);
    const visible=browseTags(getEvent(project)!,new URLSearchParams(),visibleEventPhotos(getEvent(project)!));
    expect(visible.matchingPhotoIds).not.toContain(hidden);
    expect(new Set(visible.matchingPhotoIds).size).toBe(3);
  });
  it('authenticates every new action and leaves fields unchanged on a stale form',async()=>{
    const invoke=(name:string,fields:Record<string,string>,admin=true)=>(actions[name] as Function)({params:{id:String(project)},locals:admin?{admin:{id:1}}:{},request:new Request('https://fixture.invalid',{method:'POST',body:new URLSearchParams(fields)})});
    for(const name of ['presentation','collectionPresentation','collectionSequence'])await expect(invoke(name,{},false)).rejects.toMatchObject({status:401});
    const result=await invoke('collectionPresentation',{galleryId:String(a),publicTitle:'Do not persist',publicDescription:'',sequence:JSON.stringify(sequence(a)),expected:'[]'});
    expect(result).toMatchObject({status:400});expect(listGalleries(project).find(g=>g.id===a)?.publicTitle).toBeNull();
    expect(await invoke('presentation',{galleryLayout:'simple'})).toMatchObject({ok:expect.any(String)});
    expect(getEvent(project)?.galleryLayout).toBe('simple');
  });
});
