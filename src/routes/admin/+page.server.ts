import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createEvent, listEvents } from '$server/events';
import { listCatalogs } from '$server/catalog';
import { normalizeOrderReferenceLabel } from '$shared/terminology';
import { getSettings } from '$server/settings';

export const load: PageServerLoad = () => {
  const s = getSettings();
  return { events: listEvents(), catalogs: listCatalogs(), setup: { smtp: !!s.smtp?.host, gotify: !!s.gotify?.url, venmo: !!s.venmoHandle, adminEmail: !!s.adminEmail } };
};
export const actions: Actions = {
  create: async (e) => {
    const f = await e.request.formData();
    const name = String(f.get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Give the project a name' });
    let label: string;
    try { label = normalizeOrderReferenceLabel(String(f.get('subjectLabel') ?? '')); }
    catch (err) { return fail(400, { error: (err as Error).message }); }
    const layout = f.get('galleryLayout') ?? 'directory';
    if (layout !== 'directory' && layout !== 'simple' && layout !== 'sections') return fail(400, { error: 'Choose a gallery layout.' });
    const ev = createEvent({ name, subjectLabel: label, eventDate: String(f.get('eventDate') ?? '') || null, catalogId: Number(f.get('catalogId')) || null,
      galleryLayout:layout, orderingEnabled:f.has('salesConfigured') ? f.get('orderingEnabled') === 'on' : true });
    throw redirect(303, `/admin/events/${ev.id}`);
  }
};
