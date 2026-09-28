import { sha256 } from '@noble/hashes/sha2.js';
// Hash off the UI thread with bounded memory; do not load an entire RAW into RAM.
self.onmessage = async ({data}:MessageEvent<File>) => {
  try {
    const hash=sha256.create();
    for(let offset=0;offset<data.size;offset+=4*1024*1024) hash.update(new Uint8Array(await data.slice(offset,offset+4*1024*1024).arrayBuffer()));
    self.postMessage({hash:Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('')});
  } catch { self.postMessage({error:'Could not read this file. Reselect it and retry.'}); }
};
