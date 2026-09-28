import { json, type RequestHandler } from '@sveltejs/kit';
import { finishTransfer } from '$server/resumable';
import { transferError } from '$server/transfer-response';
export const POST:RequestHandler=async({params,locals})=>{
  try {if(!locals.admin)return json({error:'Sign in first'},{status:401});return json(await finishTransfer(params.transfer ?? "",Number(params.id),locals.admin.id),{headers:{'cache-control':'no-store'}});}
  catch(err){return transferError(err);}
};
