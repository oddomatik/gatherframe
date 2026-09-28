import { Upload } from 'tus-js-client';
import { api } from './api';
import type { UploadRole } from '$shared/stem';
export type TransferProgress = {stage:'Checking file'|'Uploading'|'Verifying';bytes:number;sent:number};
const paused=()=>new DOMException('Paused. Received chunks are saved; retry to resume.','AbortError');
function hashFile(file:File,signal:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(paused());return;}
    const worker=new Worker(new URL('./file-hash.worker.ts',import.meta.url),{type:'module'});
    const close=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{close();reject(paused());};signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{close();data.hash?resolve(data.hash):reject(new Error(data.error));};
    worker.onerror=()=>{close();reject(new Error('Could not check this file. Reselect it and retry.'));};worker.postMessage(file);
  });
}
export async function uploadFile(eventId:number,file:File,input:{galleryId:number;role:UploadRole;replacement:'replace'|'reject';stemOverride?:string;tagIds:number[]},signal:AbortSignal,onprogress:(p:TransferProgress)=>void) {
  onprogress({stage:'Checking file',bytes:0,sent:0});
  const sha256=await hashFile(file,signal);
  const session=await api<{id:string;url:string;offset:number;chunkBytes:number;result?:{status:string}}>(`/admin/api/events/${eventId}/transfers`,{method:'POST',signal,json:{...input,filename:file.name,bytes:file.size,sha256}});
  if(session.result){onprogress({stage:'Verifying',bytes:file.size,sent:0});return session.result;}
  let transmitted=0,lastProgress=session.offset;
  onprogress({stage:'Uploading',bytes:session.offset,sent:0});
  await new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(paused());return;}
    const close=()=>signal.removeEventListener('abort',abort);
    const upload=new Upload(file,{
      uploadUrl:new URL(session.url,location.origin).href,chunkSize:session.chunkBytes,
      retryDelays:[0,1000,3000,5000],storeFingerprintForResuming:false,
      onShouldRetry:(error)=>!signal.aborted && (![401,403,404,409,410,413,422,507].includes(error.originalResponse?.getStatus()??0)),
      onProgress:(bytes)=>{transmitted+=Math.max(0,bytes-lastProgress);lastProgress=bytes;onprogress({stage:'Uploading',bytes,sent:transmitted});},
      onSuccess:()=>{close();resolve();},
      onError:(err)=>{close();const status='originalResponse' in err ? err.originalResponse?.getStatus() : undefined;reject(new Error(status===401?'Your login expired. Sign in in another tab, then retry.':status===410?'Transfer expired. Retry to begin a new transfer.':'Transfer interrupted. Retry to resume from the saved portion.'));}
    });
    const abort=()=>{void upload.abort().finally(()=>{close();reject(paused());});};
    signal.addEventListener('abort',abort,{once:true});upload.start();
  });
  onprogress({stage:'Verifying',bytes:file.size,sent:transmitted});
  // A lost acknowledgement is safe: finalization has a durable idempotent receipt.
  return api<{status:string}>(`/admin/api/events/${eventId}/transfers/${session.id}/finish`,{method:'POST',signal,json:{}});
}
