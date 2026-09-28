<script lang="ts">
  import {onMount,onDestroy} from 'svelte';
  import {formatBytes} from '$lib/client/api';
  import type {PublicFile} from '$server/public';
  let {slug,files}:{slug:string;files:PublicFile[]}=$props();
  let supported=$state(false), busy=$state(false), prepared=$state<File[]>([]), received=$state(0), message=$state(''), failure=$state('');
  const limit=24*1024*1024;
  const bytes=$derived(files.reduce((n,f)=>n+f.bytes,0));
  const eligible=$derived(files.length>0&&files.length<=6&&bytes<=limit&&files.every(f=>/^(jpg|jpeg)$/i.test(f.ext)));
  let controller:AbortController|undefined;
  onMount(()=>{try{supported=!!navigator.canShare?.({files:[new File(['test'],'photo.jpg',{type:'image/jpeg'})]});}catch{supported=false;}});
  onDestroy(()=>{controller?.abort();prepared=[];});
  async function prepare(){
    controller?.abort();const ac=new AbortController();controller=ac;busy=true;failure='';message='';received=0;prepared=[];
    const timer=setTimeout(()=>ac.abort(),120000);
    try{
      const result:File[]=[];
      for(const f of files){
        const response=await fetch(`/g/${slug}/file/${f.id}?via=phone`,{signal:ac.signal});
        if(!response.ok||!response.headers.get('content-type')?.startsWith('image/jpeg'))throw Error('That photo is not available right now. Try the download option below.');
        const reader=response.body?.getReader();if(!reader)throw Error('Use the download option below.');
        const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;size+=value.byteLength;if(received>limit){await reader.cancel();throw Error('These photos are too large for the share sheet. Use Download files below.');}chunks.push(value as Uint8Array<ArrayBuffer>);}
        if(size!==f.bytes)throw Error('A photo changed or the transfer stopped. Please reopen the download panel and try again.');
        result.push(new File(chunks,f.originalFilename,{type:'image/jpeg'}));
      }
      if(!navigator.canShare?.({files:result}))throw Error('Your browser cannot share these files. Use Download files below.');
      prepared=result;message='Ready. Open the share sheet to choose Photos, Files or another app where available.';
    }catch(err){if(controller===ac)failure=ac.signal.aborted?'Preparation stopped. You can retry or use Download files.':err instanceof Error?err.message:'Could not prepare these photos.';}
    finally{clearTimeout(timer);busy=false;}
  }
  async function share(){
    // Separate user tap preserves native user activation after file preparation.
    try{await navigator.share({files:prepared});message='Handed to your device’s share sheet. Check your chosen destination.';}
    catch(err){if((err as Error).name!=='AbortError')failure='The share sheet could not open. Use Download files below.';}
  }
</script>
{#if supported&&eligible}<section class="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4" aria-label="Save to your phone">
  <h3 class="font-semibold">Save or share {files.length===1?'photo':'photos'}</h3>
  <p class="mt-1 text-sm text-stone-600">JPEG files, without a ZIP.</p>
  {#if prepared.length}<button type="button" class="button-primary mt-3" onclick={share}>Open share sheet</button>
  {:else}<button type="button" class="button-primary mt-3" disabled={busy} onclick={prepare}>{busy?'Preparing photos…':files.length===1?'Prepare photo':'Prepare photos'}</button>{/if}
  {#if busy}<progress class="mt-3 w-full" max={Math.max(1,bytes)} value={received} aria-label="Preparing photos"></progress><p class="text-xs">{formatBytes(received)} of {formatBytes(bytes)}</p><button type="button" class="button-quiet" onclick={()=>controller?.abort()}>Cancel preparation</button>{/if}
  {#if message}<p role="status" class="mt-2 text-sm text-stone-600">{message}</p>{/if}
  {#if failure}<p role="alert" class="mt-2 text-sm text-red-800">{failure}</p>{/if}
</section>{/if}
