import { json, type RequestHandler } from '@sveltejs/kit';
import { receiveTransfer } from '$server/resumable';
import { transferError } from '$server/transfer-response';
const handle:RequestHandler=async({request,params,locals})=>{
  try {if(!locals.admin)return json({error:'Sign in first'},{status:401});return await receiveTransfer(params.transfer ?? "",locals.admin.id,request);}
  catch(err){return transferError(err);}
};
export const HEAD=handle;export const PATCH=handle;export const OPTIONS=handle;
