import {json,type RequestHandler} from '@sveltejs/kit';
import {undoOrganization,latestOrganization} from '$server/organization-recovery';
export const GET:RequestHandler=({params,locals})=>json({action:locals.admin?latestOrganization(Number(params.id),locals.admin.id):null},{status:locals.admin?200:401,headers:{'cache-control':'no-store'}});
export const POST:RequestHandler=async({params,request,locals})=>{
 if(!locals.admin)return json({error:'Sign in first'},{status:401});
 try {const {id}=await request.json();if(typeof id!=='string')throw new Error('Invalid sorting action');return json(undoOrganization(Number(params.id),locals.admin.id,id));}
 catch(err){return json({error:err instanceof Error?err.message:'Could not undo this save'},{status:409});}
};
