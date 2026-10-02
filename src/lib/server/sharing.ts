import { eq } from 'drizzle-orm';
import { db, sqlite, schema } from './db';
import type { Event, GuestGrant } from './db/schema';
import { randomToken, sha256 } from './secrets-ids';
import { nowIso } from './env';

export class SharingError extends Error {}
export interface GrantRow { id:number;event_id:number;token_hash:string;label:string;collection_ids:string;downloads:number;version:number;expires_at:string|null;revoked_at:string|null;created_at:string; }
export function grantById(id:number) { return sqlite.prepare('SELECT * FROM guest_grants WHERE id=?').get(id) as GrantRow|undefined; }
export function grantActive(grant:GrantRow|undefined):grant is GrantRow { return !!grant&&!grant.revoked_at&&(!grant.expires_at||grant.expires_at>nowIso()); }
export function grantScope(grant:GrantRow):GuestGrant { return {id:grant.id,version:grant.version,collectionIds:JSON.parse(grant.collection_ids),downloads:!!grant.downloads}; }
export function listGuestGrants(eventId:number) {
  return (sqlite.prepare('SELECT * FROM guest_grants WHERE event_id=? ORDER BY id DESC').all(eventId) as GrantRow[]).map(({token_hash,collection_ids,...g})=>({...g,collectionIds:JSON.parse(collection_ids) as number[],active:grantActive({...g,token_hash,collection_ids})}));
}
export function createGuestGrant(eventId:number,input:{label:string;collectionIds:number[];downloads:boolean;expiresAt?:string|null}) {
  const label=input.label.trim(), ids=[...new Set(input.collectionIds)];
  if(!label||label.length>120||!ids.length||ids.length>1000||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new SharingError('Name the link and select one or more collections.');
  const expiresAt=input.expiresAt ? new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(input.expiresAt)?input.expiresAt+'Z':input.expiresAt).toISOString() : null;
  if(expiresAt&&expiresAt<=nowIso())throw new SharingError('Choose a future expiry.');
  return sqlite.transaction(()=>{
    for(const id of ids)if(!sqlite.prepare('SELECT 1 FROM galleries WHERE id=? AND event_id=? AND is_intake=0 AND is_archived=0').get(id,eventId))throw new SharingError('Select active collections in this project.');
    const token='s_'+randomToken(32);
    const id=Number(sqlite.prepare('INSERT INTO guest_grants(event_id,token_hash,label,collection_ids,downloads,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(eventId,sha256(token),label,JSON.stringify(ids),input.downloads?1:0,expiresAt,nowIso()).lastInsertRowid);
    return {id,token};
  })();
}
export function changeGuestGrant(eventId:number,id:number,action:'revoke'|'rotate') {
  const token='s_'+randomToken(32);
  const result=action==='revoke'
    ? sqlite.prepare('UPDATE guest_grants SET revoked_at=?,version=version+1 WHERE id=? AND event_id=?').run(nowIso(),id,eventId)
    : sqlite.prepare('UPDATE guest_grants SET token_hash=?,version=version+1 WHERE id=? AND event_id=? AND revoked_at IS NULL').run(sha256(token),id,eventId);
  if(!result.changes)throw new SharingError('Link unavailable. Create a new link instead.');
  return action==='rotate'?token:null;
}
/** A scoped URL is a bearer invitation. It never expands because of another invitation or admin cookie. */
export function guestEventBySlug(slug:string):Event|undefined {
  if(slug.startsWith('s_')) {
    if(!/^s_[A-Za-z0-9_-]{43}$/.test(slug))return undefined;
    const grant=sqlite.prepare('SELECT * FROM guest_grants WHERE token_hash=?').get(sha256(slug)) as GrantRow|undefined;
    if(!grantActive(grant))return undefined;
    const event=db.select().from(schema.events).where(eq(schema.events.id,grant.event_id)).get();
    if(!event)return undefined;
    return {...event,sourceSlug:event.slug,slug,guestGrant:grantScope(grant),variantPolicy:grant.downloads?event.variantPolicy:Object.fromEntries(Object.keys(event.variantPolicy).map(k=>[k,'disabled' as const]))};
  }
  return db.select().from(schema.events).where(eq(schema.events.slug,slug)).get();
}
export function scopeAllowsCollection(event:Event,id:number):boolean { return !event.guestGrant||event.guestGrant.collectionIds.includes(id); }
export function scopeAllowsPhoto(event:Event,id:number):boolean {
  if(!event.guestGrant)return true;
  return (sqlite.prepare('SELECT g.id FROM galleries g JOIN gallery_photos gp ON gp.gallery_id=g.id JOIN photos p ON p.id=gp.photo_id WHERE gp.photo_id=? AND g.event_id=? AND g.is_intake=0 AND g.is_archived=0 AND p.rendition_status=\'ready\'').all(id,event.id) as {id:number}[]).some(g=>scopeAllowsCollection(event,g.id));
}
export function setScopedSharingOnly(eventId:number,enabled:boolean) {
  if(enabled&&!listGuestGrants(eventId).some(g=>g.active))throw new SharingError('Create an active scoped link before disabling the broad project link.');
  sqlite.prepare('UPDATE events SET scoped_sharing_only=?,updated_at=? WHERE id=?').run(enabled?1:0,nowIso(),eventId);
}
