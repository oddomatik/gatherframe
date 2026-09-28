import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEvent, listGalleries } from '$server/events';
import { compareCollectionNames } from '$shared/collection-order';
import { listTags } from '$server/tags';
import { ensureIntake } from '$server/grouping';

export const load: PageServerLoad = (e) => {
  const ev = getEvent(Number(e.params.id));
  if (!ev) throw error(404, 'Event not found');
  const intakeId = ensureIntake(ev.id);
  return { tags:listTags(ev.id), event: { id: ev.id, name: ev.name, subjectLabel: ev.subjectLabel }, galleries: listGalleries(ev.id).sort(compareCollectionNames).map((g) => ({ id: g.id, name: g.name, isIntake: g.isIntake })), initialGallery: Number(e.url.searchParams.get('g')) || intakeId };
};
