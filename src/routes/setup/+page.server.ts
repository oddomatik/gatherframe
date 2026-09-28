import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminCount, createAdmin, createSession } from '$server/auth';
import { updateSettings } from '$server/settings';
import { ensureCatalog } from '$server/catalog';

function requireSetupEnabled(): void {
  // Deployment templates default to disabled; a fresh public database must not be claimable.
  // Opt in explicitly on a private listener; an omitted variable must fail closed.
  if (process.env.SETUP_ENABLED !== '1') error(404, 'Not found');
}

export const load: PageServerLoad = () => {
  requireSetupEnabled();
  if (adminCount() > 0) throw redirect(302, '/admin');
  return {};
};

export const actions: Actions = {
  default: async (e) => {
    requireSetupEnabled();
    if (adminCount() > 0) throw redirect(302, '/admin');
    const f = await e.request.formData();
    const email = String(f.get('email') ?? '').trim(); const password = String(f.get('password') ?? '');
    const studioName = String(f.get('studioName') ?? '').trim(); const venmoHandle = String(f.get('venmoHandle') ?? '').trim();
    if (!email.includes('@')) return fail(400, { error: 'Enter a valid email' });
    if (password.length < 10) return fail(400, { error: 'Use at least 10 characters for the password' });
    const admin = await createAdmin(email, password);
    updateSettings({ studioName: studioName || 'Photo Studio', adminEmail: email, venmoHandle });
    ensureCatalog();
    createSession(admin.id, e.cookies, e.url.protocol === 'https:');
    throw redirect(303, '/admin');
  }
};
