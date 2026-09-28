import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminCount, authenticate, createSession } from '$server/auth';
import { rateLimit } from '$server/ratelimit';

export const load: PageServerLoad = (e) => { if (e.locals.admin) throw redirect(302, '/admin'); return {}; };
export const actions: Actions = {
  default: async (e) => {
    if (adminCount() === 0 && process.env.SETUP_ENABLED !== '1') {
      return fail(503, { error: 'Photographer access is being set up. Please check back soon.' });
    }
    const ip = (() => { try { return e.getClientAddress(); } catch { return 'unknown'; } })();
    if (!rateLimit(`login:${ip}`, 10, 15 * 60_000).ok) return fail(429, { error: 'Too many attempts. Wait 15 minutes.' });
    const f = await e.request.formData();
    const user = await authenticate(String(f.get('email') ?? ''), String(f.get('password') ?? ''));
    if (!user) return fail(400, { error: 'Email or password is wrong' });
    createSession(user.id, e.cookies, e.url.protocol === 'https:');
    const next = String(f.get('next') ?? '/admin');
    throw redirect(303, next.startsWith('/admin') ? next : '/admin');
  }
};
