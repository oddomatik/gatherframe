import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./env',()=>({env:{secret:'sharing-fixture',publicOrigin:'https://fixture.invalid'},nowIso:()=>new Date().toISOString()}));
vi.mock('./db',async()=>{const {default:Database}=await import('better-sqlite3');const {drizzle}=await import('drizzle-orm/better-sqlite3');const schema=await import('./db/schema'),{MIGRATIONS}=await import('./db/migrations');const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql);return {sqlite,schema,db:drizzle(sqlite,{schema})};});
import Database from 'better-sqlite3';
import { MIGRATIONS } from './db/migrations';
import { db,schema,sqlite } from './db';
import { createEvent,getEvent,listGalleries,updateEvent,listEventPhotos } from './events';
import { createCollection,ensureIntake } from './grouping';
import { createGuestGrant,guestEventBySlug,changeGuestGrant,scopeAllowsPhoto,setScopedSharingOnly,listGuestGrants,grantById } from './sharing';
import { mediaUrl,validMediaToken } from './media-access';
import { eventAccessState } from './access';
import { publicGalleries,publicPhotos,publicDayCounts } from './public';
import { visibleEventPhotos,browseTags } from './tag-browsing';
import { createProofRound,getProofRound,guestProofRound,saveProofSelection,reviewProofRound,proofHistory } from './proofing';
import type { Event } from './db/schema';
import type { Cookies } from '@sveltejs/kit';
let project:number,a:number,b:number,tray:number,soloA:number,soloB:number,shared:number,intake:number,first:ReturnType<typeof createGuestGrant>,second:ReturnType<typeof createGuestGrant>;
function photo(stem:string,collections:number[]) {const id=db.insert(schema.photos).values({galleryId:tray,stem,displayName:stem,renditionStatus:'ready',createdAt:'fixture',updatedAt:'fixture'}).returning().get().id;for(const galleryId of collections)db.insert(schema.galleryPhotos).values({galleryId,photoId:id}).run();return id;}
const cookie={get:()=>undefined} as unknown as Cookies;
const scoped=()=>guestEventBySlug(first.token)!;
const claim=(event:Event,id:number)=>new URL(mediaUrl(event,id,'preview'),'https://fixture.invalid').searchParams.get('t');
beforeEach(()=>{sqlite.exec('DELETE FROM events');project=createEvent({name:'Scope fixture'}).id;updateEvent(project,{isPublished:1});tray=ensureIntake(project);a=createCollection(project,'PRIVATE A');b=createCollection(project,'PRIVATE B');soloA=photo('A',[a]);soloB=photo('B',[b]);shared=photo('Both',[a,b]);intake=photo('Intake',[tray]);first=createGuestGrant(project,{label:'Recipient A',collectionIds:[a],downloads:true});second=createGuestGrant(project,{label:'Recipient B',collectionIds:[b],downloads:false});});
afterAll(()=>sqlite.close());
describe('scoped invitations',()=>{
 it('upgrades an existing project without changing its data or enabling restricted mode',()=>{
  const old=new Database(':memory:');try {
   for(const m of MIGRATIONS.filter(m=>m.id!=='0017_scoped_sharing_and_proofs'))old.exec(m.sql);
   old.exec("INSERT INTO events(slug,name,variant_policy,is_published,created_at,updated_at) VALUES('old','Existing','{}',1,'old','old')");
   const before=old.prepare('SELECT * FROM events').get() as Record<string,unknown>;
   old.exec(MIGRATIONS.find(m=>m.id==='0017_scoped_sharing_and_proofs')!.sql);
   expect(old.prepare('SELECT * FROM events').get()).toEqual({...before,scoped_sharing_only:0});
   expect(old.prepare('SELECT count(*) n FROM guest_grants').get()).toEqual({n:0});
  } finally {old.close();}
 });
 it('hashes random tokens, rejects missing/foreign/intake/archived scopes and invalid expiry',()=>{
  expect(grantById(first.id)?.token_hash).not.toBe(first.token);expect(JSON.stringify(listGuestGrants(project))).not.toContain(first.token);expect(guestEventBySlug(first.token+'x')).toBeUndefined();
  const other=createEvent({name:'Other'}).id,c=createCollection(other,'Elsewhere');
  for(const ids of [[],[tray],[c],[99999]])expect(()=>createGuestGrant(project,{label:'No',collectionIds:ids,downloads:false})).toThrow();
  sqlite.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(b);expect(()=>createGuestGrant(project,{label:'No',collectionIds:[b],downloads:false})).toThrow();
  expect(()=>createGuestGrant(project,{label:'No',collectionIds:[a],downloads:false,expiresAt:'2000-01-01'})).toThrow();
 });
 it('intersects all photo/collection serializers and counts, including overlapping photos',()=>{
  const event=scoped();expect(visibleEventPhotos(event).map(p=>p.id)).toEqual([soloA,shared]);expect(scopeAllowsPhoto(event,soloB)).toBe(false);expect(scopeAllowsPhoto(event,intake)).toBe(false);
  expect(publicPhotos(listEventPhotos(project),event.variantPolicy,event).map(p=>p.id)).toEqual([soloA,shared]);expect(publicGalleries(listGalleries(project),event).map(g=>g.id)).toEqual([a]);expect(publicDayCounts(event).all).toBe(2);
  expect(JSON.stringify(browseTags(event,new URLSearchParams(),visibleEventPhotos(event)))).not.toMatch(/PRIVATE|Recipient/);
 });
 it('keeps project password/publication/expiry checks and explicitly disables broad links',()=>{
  const event=getEvent(project)!;expect(eventAccessState(event,cookie,false)).toBe('ok');setScopedSharingOnly(project,true);expect(eventAccessState(getEvent(project)!,cookie,false)).toBe('unpublished');expect(eventAccessState(scoped(),cookie,false)).toBe('ok');expect(eventAccessState(getEvent(project)!,cookie,true)).toBe('ok');
  updateEvent(project,{passwordHash:'hash'});expect(eventAccessState(scoped(),cookie,false)).toBe('locked');updateEvent(project,{isPublished:0});expect(eventAccessState(scoped(),cookie,false)).toBe('unpublished');updateEvent(project,{isPublished:1,expiresAt:'2000-01-01'});expect(eventAccessState(scoped(),cookie,false)).toBe('expired');
 });
 it('invalidates saved media capabilities after rotation/revoke/expiry and cannot forge another photo',()=>{
  const event=scoped(),token=claim(event,soloA);expect(validMediaToken(token,getEvent(project)!,soloA,'preview')).toBe(true);expect(validMediaToken(token,getEvent(project)!,soloB,'preview')).toBe(false);expect(validMediaToken(claim(event,soloB),getEvent(project)!,soloB,'preview')).toBe(false);
  const rotated=changeGuestGrant(project,first.id,'rotate')!;expect(guestEventBySlug(first.token)).toBeUndefined();expect(validMediaToken(token,getEvent(project)!,soloA,'preview')).toBe(false);
  const fresh=claim(guestEventBySlug(rotated)!,soloA);expect(validMediaToken(fresh,getEvent(project)!,soloA,'preview')).toBe(true);changeGuestGrant(project,first.id,'revoke');expect(validMediaToken(fresh,getEvent(project)!,soloA,'preview')).toBe(false);expect(guestEventBySlug(rotated)).toBeUndefined();
  sqlite.prepare('UPDATE guest_grants SET expires_at=? WHERE id=?').run('2000-01-01',second.id);expect(guestEventBySlug(second.token)).toBeUndefined();
 });
 it('broad-mode removal revokes old media and collection changes immediately narrow scoped media',()=>{
  const broad=getEvent(project)!,old=claim(broad,soloB),narrow=claim(scoped(),soloA);setScopedSharingOnly(project,true);expect(validMediaToken(old,getEvent(project)!,soloB,'preview')).toBe(false);expect(validMediaToken(narrow,getEvent(project)!,soloA,'preview')).toBe(true);
  sqlite.prepare('DELETE FROM gallery_photos WHERE gallery_id=? AND photo_id=?').run(a,soloA);expect(validMediaToken(narrow,getEvent(project)!,soloA,'preview')).toBe(false);
  const sharedToken=claim(scoped(),shared);sqlite.prepare('UPDATE galleries SET is_archived=1 WHERE id=?').run(a);expect(validMediaToken(sharedToken,getEvent(project)!,shared,'preview')).toBe(false);
 });
 it('view-only never widens configured delivery policy; appended membership is intentionally live',()=>{
  expect(Object.values(guestEventBySlug(second.token)!.variantPolicy).every(v=>v==='disabled')).toBe(true);updateEvent(project,{variantPolicy:{print:'disabled',social:'free'}});expect(scoped().variantPolicy).toEqual({print:'disabled',social:'free'});
  db.insert(schema.galleryPhotos).values({galleryId:a,photoId:soloB}).run();expect(scopeAllowsPhoto(scoped(),soloB)).toBe(true);
 });
 it('prevents narrowing/expanding a different project invitation through owner actions',()=>{
  const other=createEvent({name:'Other'}).id;expect(()=>changeGuestGrant(other,first.id,'revoke')).toThrow();expect(()=>setScopedSharingOnly(other,true)).toThrow();expect(guestEventBySlug(first.token)).toBeDefined();
 });
});
describe('persistent proof selections',()=>{
 const input=(photoIds:number[],version=0,submit=false)=>({version,photoIds,notes:{},message:'',submit});
 it('binds a round to exactly one invitation; out-of-scope photos never enter drafts',()=>{
  const id=createProofRound(project,first.id,'Choose your images');expect(()=>guestProofRound(guestEventBySlug(second.token)!,id)).toThrow();expect(()=>guestProofRound(getEvent(project)!,id)).toThrow();expect(()=>saveProofSelection(scoped(),id,input([soloB]))).toThrow();expect(getProofRound(id)?.version).toBe(0);
 });
 it('persists a draft separately from favorites, locks submission and preserves immutable revision history',()=>{
  const id=createProofRound(project,first.id,'Choose');saveProofSelection(scoped(),id,{...input([soloA]),notes:{[soloA]:'Warm tones'},message:'Please edit'});expect(guestProofRound(scoped(),id).selected).toEqual([soloA]);expect(proofHistory(id)).toHaveLength(0);
  const submit={...input([soloA],1,true),notes:{[soloA]:'Warm tones'},message:'Please edit'};saveProofSelection(scoped(),id,submit);expect(proofHistory(id)).toHaveLength(1);expect(saveProofSelection(scoped(),id,submit).replay).toBe(true);expect(proofHistory(id)).toHaveLength(1);
  expect(()=>saveProofSelection(scoped(),id,input([shared],2))).toThrow();reviewProofRound(project,id,2,'open','Choose one more');saveProofSelection(scoped(),id,input([soloA,shared],3,true));expect(proofHistory(id)).toHaveLength(2);expect(JSON.parse(proofHistory(id)[1].selection)).toEqual([soloA]);reviewProofRound(project,id,4,'accepted','Approved');expect(getProofRound(id)?.status).toBe('accepted');
 });
 it('rejects stale drafts/reviews, empty submission, excessive notes and mismatched note IDs',()=>{
  const id=createProofRound(project,first.id,'Choose');expect(()=>saveProofSelection(scoped(),id,input([],0,true))).toThrow();expect(()=>saveProofSelection(scoped(),id,{...input([soloA]),notes:{[soloB]:'No'}})).toThrow();expect(()=>saveProofSelection(scoped(),id,{...input([soloA]),notes:{[soloA]:'x'.repeat(501)}})).toThrow();
  saveProofSelection(scoped(),id,input([soloA]));expect(()=>saveProofSelection(scoped(),id,input([shared]))).toThrow();expect(()=>reviewProofRound(project,id,0,'closed','')).toThrow();expect(()=>reviewProofRound(project,id,1,'accepted','')).toThrow();
 });
 it('revocation stops edits and withdrawn photos disappear from guest results while owner evidence survives',()=>{
  const id=createProofRound(project,first.id,'Choose'),event=scoped();saveProofSelection(event,id,{...input([soloA],0,true),notes:{[soloA]:'Note'}});sqlite.prepare('DELETE FROM gallery_photos WHERE gallery_id=? AND photo_id=?').run(a,soloA);expect(guestProofRound(scoped(),id).selected).toEqual([]);expect(guestProofRound(scoped(),id).notes).toEqual({});expect(JSON.parse(proofHistory(id)[0].selection)).toEqual([soloA]);reviewProofRound(project,id,1,'open','');changeGuestGrant(project,first.id,'revoke');expect(()=>saveProofSelection(event,id,input([shared],2))).toThrow();
 });
});
