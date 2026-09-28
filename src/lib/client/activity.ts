/** Best-effort first-party metrics: no dependency on localStorage, no URLs or personal data in payloads. */
export function activity(slug:string,kind:string,details:{collection?:string;photoId?:number}={}) {
 if(typeof window==='undefined')return;
 try{void fetch(`/g/${encodeURIComponent(slug)}/api/activity`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),kind,...details}),keepalive:true}).catch(()=>{});}catch{/* Gallery actions must work even when analytics is blocked. */}
}
