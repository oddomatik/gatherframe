import { json, type RequestHandler } from '@sveltejs/kit';
import { prepareTransfer } from '$server/resumable';
import { transferError } from '$server/transfer-response';
export const POST:RequestHandler=async({request,params,locals})=>{
  try {if(!locals.admin)return json({error:'Sign in first'},{status:401});const text=await request.text();if(text.length>16000)return json({error:'Transfer details too large'},{status:413});return json(await prepareTransfer(Number(params.id),locals.admin.id,JSON.parse(text)),{headers:{'cache-control':'no-store'}});}
  catch(err){if(err instanceof SyntaxError)return json({error:"Invalid transfer details"},{status:400});return transferError(err);}
};
