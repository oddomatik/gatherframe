import { createHmac, randomUUID } from 'node:crypto';
import { sqlite } from './db';
import { env } from './env';
import type { RequestEvent } from '@sveltejs/kit';
import type { Readable } from 'node:stream';

export const clientKinds = ['album_view','collection_view','browse_view','photo_view','family_add','family_remove','favorite_add','favorite_remove'] as const;
export type ClientKind = typeof clientKinds[number];
type Activity = { kind: ClientKind | 'download_start' | 'download_complete'; galleryId?: number | null; photoId?: number | null;
 channel?: string; social?: number; print?: number; raw?: number; bytes?: number };
export function guestTraffic(e: Pick<RequestEvent,'locals'|'request'>) {
 return !e.locals?.demo && !e.locals?.admin && !/bot|crawler|spider|preview|facebookexternalhit|whatsapp|headless/i.test(e.request.headers.get('user-agent') ?? '');
}
export function visitorKey(eventId: number, sid: string) {
 return createHmac('sha256',env.secret).update(`activity:${eventId}:${sid}`).digest('hex');
}
let sweepAt = 0;
/** Analytics is best-effort and must never prevent a guest action or file delivery. */
export function recordActivity(eventId:number,sid:string,id:string,a:Activity,now=new Date()) {
 try {
  if(now.getTime()>sweepAt){sqlite.prepare('DELETE FROM guest_activity WHERE created_at < ?').run(new Date(now.getTime()-90*86400000).toISOString());sweepAt=now.getTime()+3600000;}
  sqlite.prepare(`INSERT OR IGNORE INTO guest_activity
   (id,event_id,visitor,kind,gallery_id,photo_id,channel,social_files,print_files,raw_files,bytes,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(createHmac('sha256',env.secret).update(`${eventId}:${sid}:${id}`).digest('hex'),eventId,visitorKey(eventId,sid),a.kind,a.galleryId??null,a.photoId??null,a.channel??null,a.social??0,a.print??0,a.raw??0,a.bytes??0,now.toISOString());
 }catch{/* A metrics failure does not break the gallery. */}
}
/** Count only full response EOF as sent. A partial/range response or aborted stream is not a complete file. */
export function trackDownload(e:RequestEvent,eventId:number,sid:string,stream:Readable|null,a:Omit<Activity,'kind'>,complete=true) {
 if(e.request.method!=='GET'||!guestTraffic(e)||e.request.signal.aborted)return;
 const id=randomUUID();
 recordActivity(eventId,sid,`${id}:start`,{...a,kind:'download_start'});
 if(!stream)return;
 stream.once('end',()=>{if(complete&&!e.request.signal.aborted)recordActivity(eventId,sid,`${id}:complete`,{...a,kind:'download_complete'});});
}
export function activityWindow(url:URL,now=new Date()) {
 const today=now.toISOString().slice(0,10), earliest=new Date(now.getTime()-89*86400000).toISOString().slice(0,10);
 const valid=(s:string|null):s is string=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const endParam=url.searchParams.get('to'), startParam=url.searchParams.get('from');
 const to=valid(endParam)?[earliest,endParam,today].sort()[1]:today;
 const fallback=new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10);
 const from=[earliest,valid(startParam)?startParam:fallback,to].sort()[1];
 const project=Number(url.searchParams.get('event'));
 return {from,to,eventId:Number.isSafeInteger(project)&&project>0?project:null};
}
export function activityReport(from:string,to:string,eventId:number|null) {
 const start=from+'T00:00:00.000Z', end=new Date(Date.parse(to)+86400000).toISOString();
 const where='a.created_at>=? AND a.created_at<?'+(eventId?' AND a.event_id=?':'');
 const params=eventId?[start,end,eventId]:[start,end];
 const counts=sqlite.prepare(`SELECT kind,count(*) n FROM guest_activity a WHERE ${where} GROUP BY kind`).all(...params) as {kind:string;n:number}[];
 const totals=Object.fromEntries(counts.map(r=>[r.kind,r.n]));
 const browsers=(sqlite.prepare(`SELECT count(DISTINCT visitor) n FROM guest_activity a WHERE ${where}`).get(...params) as {n:number}).n;
 const daily=sqlite.prepare(`SELECT substr(created_at,1,10) day,
 sum(kind IN ('album_view','collection_view','browse_view')) views,sum(kind='favorite_add') favorites,
 sum(kind='download_complete') downloads FROM guest_activity a WHERE ${where} GROUP BY day ORDER BY day`).all(...params) as {day:string;views:number;favorites:number;downloads:number}[];
 const downloads=sqlite.prepare(`SELECT channel,count(*) transfers,sum(social_files) social,sum(print_files) print,sum(raw_files) raw,sum(bytes) bytes
 FROM guest_activity a WHERE ${where} AND kind='download_complete' GROUP BY channel`).all(...params) as {channel:string;transfers:number;social:number;print:number;raw:number;bytes:number}[];
 const collections=sqlite.prepare(`SELECT g.id,g.name,e.id eventId,e.name project,
 sum(a.kind='collection_view') views,sum(a.kind='family_add') adds,sum(a.kind='family_remove') removes
 FROM guest_activity a JOIN galleries g ON g.id=a.gallery_id JOIN events e ON e.id=a.event_id
 WHERE ${where} GROUP BY g.id ORDER BY views DESC,adds DESC,g.name COLLATE NOCASE LIMIT 50`).all(...params) as {id:number;name:string;eventId:number;project:string;views:number;adds:number;removes:number}[];
 const photos=sqlite.prepare(`SELECT p.id,p.stem,e.id eventId,e.name project,
 sum(a.kind='photo_view') views,sum(a.kind='favorite_add') adds,sum(a.kind='favorite_remove') removes
 FROM guest_activity a JOIN photos p ON p.id=a.photo_id JOIN events e ON e.id=a.event_id
 WHERE ${where} GROUP BY p.id HAVING views+adds+removes>0 ORDER BY adds DESC,views DESC LIMIT 30`).all(...params) as {id:number;stem:string;eventId:number;project:string;views:number;adds:number;removes:number}[];
 const startedAt=(sqlite.prepare("SELECT value FROM activity_meta WHERE key='started_at'").get() as {value:string}).value;
 return {totals,browsers,daily,downloads,collections,photos,startedAt};
}
