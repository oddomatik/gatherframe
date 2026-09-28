export type SortingTarget={key:string;id?:number;name:string;photoIds:number[];coverId:number|null;coverHash:string|null};
export type SortingDraft={version:1;photoIds:number[];active:number[];targets:SortingTarget[];search:string;newName:string;selectionMode:boolean;baseline:string;pending?:{requestId:string;revision:string;photoIds:number[];targets:unknown[]};updatedAt:string};
export type DraftRecord={key:string;revision:number;draft:SortingDraft|null};
export class DraftConflict extends Error {constructor(){super('This draft changed in another tab. Your screen edits are still here; reopen the saved draft before continuing.');}}
export const draftKey=(actor:number,event:number)=>`sorting:${actor}:${event}`;
function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('picture-day-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('drafts',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Another tab is blocking draft storage. Close that tab and retry.'));});}
export async function readDraft(key:string):Promise<DraftRecord>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),req=tx.objectStore('drafts').get(key);let record:DraftRecord;req.onsuccess=()=>{record=req.result??{key,revision:0,draft:null};};tx.oncomplete=()=>{db.close();resolve(record);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error);};});}
export async function writeDraft(key:string,revision:number,draft:SortingDraft|null):Promise<DraftRecord>{
 if(draft&&JSON.stringify(draft).length>2_000_000)throw new Error('Draft too large for device storage. Keep this tab open.');
 const db=await openDB();return new Promise((resolve,reject)=>{
   const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),req=store.get(key);let conflict=false,cause:unknown;
   const record={key,revision:revision+1,draft};
   req.onsuccess=()=>{if((req.result?.revision??0)!==revision){conflict=true;tx.abort();}else try{store.put(record);}catch(err){cause=err;tx.abort();}};
   tx.oncomplete=()=>{db.close();try{const channel=new BroadcastChannel('picture-day-drafts');channel.postMessage(key);channel.close();}catch{/* optional tab notification */}resolve(record);};
   tx.onabort=tx.onerror=()=>{db.close();reject(conflict?new DraftConflict():cause??tx.error??new Error('Device storage unavailable'));};
 });
}
