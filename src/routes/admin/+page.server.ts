import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createEvent, listEvents } from '$server/events';
import { listCatalogs } from '$server/catalog';
import { getSettings } from '$server/settings';

export const load: PageServerLoad = () => {
  const s = getSettings();
  return { events: listEvents(), catalogs: listCatalogs(), setup: { smtp: !!s.smtp?.host, gotify: !!s.gotify?.url, venmo: !!s.venmoHandle, adminEmail: !!s.adminEmail } };
};
export const actions: Actions = {
  create: async (e) => {
    const f = await e.request.formData();
    const name = String(f.get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Give the event a name' });
    const ev = createEvent({ name, subjectLabel: String(f.get('subjectLabel') ?? 'child'), eventDate: String(f.get('eventDate') ?? '') || null, catalogId: Number(f.get('catalogId')) || null });
    throw redirect(303, `/admin/events/${ev.id}`);
  }
};
