import {json,type RequestHandler} from '@sveltejs/kit';
import {organizationState} from '$server/organization-recovery';
export const POST:RequestHandler=async({params,request,locals})=>{
 if(!locals.admin)return json({error:'Sign in first'},{status:401});
 try {const {photoIds}=await request.json();return json({revision:organizationState(Number(params.id),photoIds).revision},{headers:{'cache-control':'no-store'}});}
 catch(err){return json({error:err instanceof Error?err.message:'Could not read sorting state'},{status:409});}
};
