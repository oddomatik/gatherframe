import {afterAll,beforeEach,expect,it,vi} from 'vitest';
vi.mock('./env',()=>({env:{secret:'test-only',publicOrigin:'https://fixture.invalid'},nowIso:()=>new Date().toISOString()}));
vi.mock('./db',async()=>{
 const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');const schema=await import('./db/schema');const {MIGRATIONS}=await import('./db/migrations');
 const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);return{sqlite,schema,db:drizzle(sqlite,{schema})};
});
import {sqlite,db,schema} from './db';
import {createEvent} from './events';
import {changePhotoTags,deleteTag,listTags,publicTagData,saveTag,tagAssignments} from './tags';
import {tagIsShared,tagPath} from '$shared/tags';
import {browseTags,visibleEventPhotos} from './tag-browsing';
import {MIGRATIONS} from './db/migrations';
import Database from 'better-sqlite3';
let event:typeof schema.events.$inferSelect, other:typeof schema.events.$inferSelect, a:number,b:number,privatePhoto:number,gid:number;
const now=new Date().toISOString();
beforeEach(()=>{
 sqlite.exec('DELETE FROM events');event=createEvent({name:'Flexible project'});other=createEvent({name:'Another shoot'});
 gid=db.insert(schema.galleries).values({eventId:event.id,publicId:'child',name:'PRIVATE CHILD',createdAt:now}).returning().get().id;
 const intake=db.insert(schema.galleries).values({eventId:event.id,publicId:'intake',name:'PRIVATE INTAKE',isIntake:1,createdAt:now}).returning().get().id;
 function photo(galleryId:number,stem:string){const p=db.insert(schema.photos).values({galleryId,stem,displayName:stem,renditionStatus:'ready',createdAt:now,updatedAt:now}).returning().get();db.insert(schema.galleryPhotos).values({galleryId,photoId:p.id}).run();return p.id;}
 a=photo(gid,'IMG_2');b=photo(gid,'IMG_10');privatePhoto=photo(intake,'PRIVATE_FILE');
});
afterAll(()=>sqlite.close());
it('starts empty; arbitrary nesting and stable links survive rename/reparent; cycles are rejected',()=>{
 expect(listTags(event.id)).toEqual([]);
 const root=saveTag(event.id,{name:'Groups',shared:true});const leaf=saveTag(event.id,{name:'Blue team',parentId:root.id,shared:true});const otherRoot=saveTag(event.id,{name:'Activities',shared:true});
 expect(()=>saveTag(event.id,{...root,parentId:leaf.id})).toThrow(/descendant/);
 const moved=saveTag(event.id,{...leaf,name:'Jumping',parentId:otherRoot.id});expect(moved.publicId).toBe(leaf.publicId);expect(tagPath(listTags(event.id),leaf.id)).toBe('Activities / Jumping');
 expect(()=>saveTag(event.id,{name:'jumping',parentId:otherRoot.id,shared:true})).toThrow(/already/);
 expect(()=>deleteTag(event.id,otherRoot.id)).toThrow(/child/);
});
it('enforces event boundaries and all-or-nothing assignment without changing photos or collections',()=>{
 const t=saveTag(event.id,{name:'Group 7',shared:true}),foreign=saveTag(other.id,{name:'Foreign',shared:true});
 const before=JSON.stringify(sqlite.prepare('SELECT * FROM photos').all());const members=sqlite.prepare('SELECT * FROM gallery_photos').all();
 expect(()=>changePhotoTags(event.id,[a,b],[t.id,foreign.id],'add')).toThrow();expect(tagAssignments(event.id)).toEqual({});
 expect(()=>changePhotoTags(event.id,[a,99999],[t.id],'add')).toThrow();expect(tagAssignments(event.id)).toEqual({});
 expect(()=>saveTag(event.id,{...t,parentId:foreign.id})).toThrow();
 changePhotoTags(event.id,[a,b],[t.id],'add');changePhotoTags(event.id,[a,b],[t.id],'add');expect(tagAssignments(event.id)).toEqual({[a]:[t.id],[b]:[t.id]});
 expect(JSON.stringify(sqlite.prepare('SELECT * FROM photos').all())).toBe(before);expect(sqlite.prepare('SELECT * FROM gallery_photos').all()).toEqual(members);
 changePhotoTags(event.id,[a],[t.id],'remove');expect(tagAssignments(event.id)).toEqual({[b]:[t.id]});
});
it('matches entire subtrees, intersects or unions multiple tags and counts shared moments once',()=>{
 const group=saveTag(event.id,{name:'Groups',shared:true}),one=saveTag(event.id,{name:'One',parentId:group.id,shared:true}),two=saveTag(event.id,{name:'Two',parentId:group.id,shared:true}),activity=saveTag(event.id,{name:'Play',shared:true});
 changePhotoTags(event.id,[a],[one.id,activity.id],'add');changePhotoTags(event.id,[b],[two.id],'add');
 expect(publicTagData(event.id,[a,b],new URLSearchParams({tags:group.publicId})).matchingPhotoIds).toEqual([a,b]);
 expect(publicTagData(event.id,[a,b],new URLSearchParams({tags:`${group.publicId},${activity.publicId}`,match:'all'})).matchingPhotoIds).toEqual([a]);
 expect(publicTagData(event.id,[a,b],new URLSearchParams({tags:`${one.publicId},${two.publicId}`})).matchingPhotoIds).toEqual([a,b]);
 const result=publicTagData(event.id,[a,b],new URLSearchParams());expect(result.tags.find(t=>t.id===group.id)?.count).toBe(2);
});
it('hides private branches, rejects obsolete/foreign links rather than widening to all photos',()=>{
 const root=saveTag(event.id,{name:'PRIVATE ROOT',shared:false}),child=saveTag(event.id,{name:'PRIVATE CHILD TAG',parentId:root.id,shared:true}),shared=saveTag(event.id,{name:'Published group',shared:true});
 changePhotoTags(event.id,[a],[child.id,shared.id],'add');expect(tagIsShared(listTags(event.id),child.id)).toBe(false);
 expect(JSON.stringify(publicTagData(event.id,[a,b],new URLSearchParams()))).not.toContain('PRIVATE');
 expect(()=>publicTagData(event.id,[a,b],new URLSearchParams({tags:child.publicId}))).toThrow();
 deleteTag(event.id,shared.id);expect(()=>publicTagData(event.id,[a,b],new URLSearchParams({tags:shared.publicId}))).toThrow();
});
it('shared tags do not publish intake/archived/unfinished photos and select matching collection covers',()=>{
 const tag=saveTag(event.id,{name:'Activity',shared:true});changePhotoTags(event.id,[b,privatePhoto],[tag.id],'add');
 const result=browseTags(event,new URLSearchParams({tags:tag.publicId}),visibleEventPhotos(event));expect(result.matchingPhotoIds).toEqual([b]);expect(result.photos.map(p=>p.id)).toEqual([a,b]);expect(result.siblings[0]).toMatchObject({photoCount:1,coverThumbId:b});
 expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('migration copies only actual day assignments, leaves every existing row intact, and is event scoped',()=>{
 const fixture=new Database(':memory:');fixture.pragma('foreign_keys=ON');for(const m of MIGRATIONS.slice(0,MIGRATIONS.findIndex(m=>m.id==='0007_project_tag_hierarchy')))fixture.exec(m.sql);
 const stamp='2026-09-26';
 fixture.prepare("INSERT INTO events(id,slug,name,variant_policy,created_at,updated_at) VALUES(1,'one','One','{}',?,?),(2,'two','Two','{}',?,?)").run(stamp,stamp,stamp,stamp);
 fixture.prepare("INSERT INTO galleries(id,event_id,public_id,name,created_at) VALUES(1,1,'one','One',?)").run(stamp);
 fixture.prepare("INSERT INTO photos(id,gallery_id,stem,display_name,shoot_day,created_at,updated_at) VALUES(1,1,'a','A',1,?,?),(2,1,'b','B',null,?,?)").run(stamp,stamp,stamp,stamp);
 fixture.prepare("INSERT INTO photos(id,gallery_id,stem,display_name,shoot_day,created_at,updated_at) VALUES(3,1,'c','C',1,?,?)").run(stamp,stamp);
 const rows=fixture.prepare('SELECT * FROM photos').all();fixture.exec(MIGRATIONS.find(m=>m.id==='0007_project_tag_hierarchy')!.sql);
 expect(fixture.prepare('SELECT name FROM tags WHERE event_id=1').all()).toEqual([{name:'Days'},{name:'Day 1'}]);expect(fixture.prepare('SELECT * FROM tags WHERE event_id=2').all()).toEqual([]);
 expect(fixture.prepare('SELECT photo_id FROM photo_tags').all()).toEqual([{photo_id:1},{photo_id:3}]);expect(fixture.prepare('SELECT * FROM photos').all()).toEqual(rows);expect(fixture.pragma('foreign_key_check')).toEqual([]);fixture.close();
});
