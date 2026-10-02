import { scopeAllowsPhoto, scopeAllowsCollection } from '$server/sharing';
import { error, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireEventAccess } from '$server/guard';
import { sqlite } from '$server/db';
import { visiblePhoto } from '$server/media-access';
import { clientKinds, guestTraffic, recordActivity, visitorKey } from '$server/activity';
import { rateLimit } from '$server/ratelimit';
const Body=z.object({id:z.string().uuid(),kind:z.enum(clientKinds),collection:z.string().regex(/^[\w-]{1,100}$/).optional(),photoId:z.number().int().positive().optional()}).strict();
export const POST:RequestHandler=async e=>{
 if(e.request.headers.get('origin')!==e.url.origin || (e.request.headers.has('sec-fetch-site')&&e.request.headers.get('sec-fetch-site')!=='same-origin'))throw error(403,'Same-origin only');
 const {event,sid}=requireEventAccess(e);
 if(!guestTraffic(e))return new Response(null,{status:204});
 if(!rateLimit(`activity:${visitorKey(event.id,sid)}`,180,60000).ok)throw error(429,'Too many events');
 if(!e.request.headers.get('content-type')?.startsWith('application/json'))throw error(415,'JSON required');
 const reader=e.request.body?.getReader();if(!reader)throw error(400,'Invalid event');
 let text='';const decoder=new TextDecoder();let bytes=0;
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024){await reader.cancel();throw error(413,'Too large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
 let body:unknown;try{body=JSON.parse(text);}catch{throw error(400,'Invalid event');}
 const parsed=Body.safeParse(body);if(!parsed.success)throw error(400,'Invalid event');
 const a=parsed.data;let galleryId:number|undefined;
 if(a.collection){const row=sqlite.prepare('SELECT id FROM galleries WHERE public_id=? AND event_id=? AND is_archived=0 AND is_intake=0').get(a.collection,event.id) as {id:number}|undefined;if(!row||!scopeAllowsCollection(event,row.id))throw error(404,'Collection unavailable');galleryId=row.id;}
 if(['family_add','family_remove','collection_view'].includes(a.kind)&&!galleryId)throw error(400,'Collection required');
 if(['photo_view','favorite_add','favorite_remove'].includes(a.kind)&&!a.photoId)throw error(400,'Photo required');
 if(a.photoId&&!(visiblePhoto(a.photoId, event.id) && scopeAllowsPhoto(event,a.photoId)))throw error(404,'Photo unavailable');
 if(a.photoId&&galleryId&&!sqlite.prepare('SELECT 1 FROM gallery_photos WHERE gallery_id=? AND photo_id=?').get(galleryId,a.photoId))throw error(404,'Photo unavailable');
 recordActivity(event.id,sid,a.id,{kind:a.kind,galleryId,photoId:a.photoId});
 return new Response(null,{status:204});
};
