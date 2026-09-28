import { json } from '@sveltejs/kit';
import { IngestError } from './ingest';
import { StorageError } from './blob-store';
export function transferError(err:unknown) {
  const status=err instanceof IngestError?err.status:err instanceof StorageError?(err.code==='disk_full'?507:503):500;
  if(status===500) console.error('[transfer]',err);
  return json({error:status===500?'Could not finish this transfer. Retry safely.':(err as Error).message},{status,headers:{'cache-control':'no-store'}});
}
