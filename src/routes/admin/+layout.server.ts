import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { adminCount } from '$server/auth';
import { countNewOrders } from '$server/orders';
import { getSettings } from '$server/settings';

export const load: LayoutServerLoad = (e) => {
  const photographerAccessPending = adminCount() === 0;
  if (photographerAccessPending && process.env.SETUP_ENABLED === '1') throw redirect(302, '/setup');
  const isLogin = e.route.id === '/admin/login';
  if (!e.locals.admin && !isLogin) throw redirect(302, `/admin/login?next=${encodeURIComponent(e.url.pathname)}`);
  return { admin: e.locals.admin, newOrders: e.locals.admin ? countNewOrders() : 0, studioName: getSettings().studioName, photographerAccessPending };
};
