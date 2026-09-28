import { error } from '@sveltejs/kit';
import { activityReport,activityWindow } from '$server/activity';
import { listEvents } from '$server/events';
import type { PageServerLoad } from './$types';
export const load:PageServerLoad=e=>{
 if(!e.locals.admin)throw error(401,'Sign in first');
 e.setHeaders({'cache-control':'private, no-store'});
 const filter=activityWindow(e.url),events=listEvents().map(({id,name})=>({id,name}));
 if(filter.eventId&&!events.some(p=>p.id===filter.eventId))throw error(404,'Project not found');
 return {filter,events,report:activityReport(filter.from,filter.to,filter.eventId)};
};
