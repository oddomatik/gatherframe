import { redirect, type RequestHandler } from '@sveltejs/kit';
import { destroySession } from '$server/auth';
export const POST: RequestHandler = (e) => { destroySession(e.cookies); throw redirect(303, '/admin/login'); };
