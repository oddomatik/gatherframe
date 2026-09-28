import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { db, schema } from '$server/db';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = (e) => {
  const { event, state } = eventContext(e);
  if (state !== 'ok') return {};
  const photoId = Number(e.params.photoId);
  const row = db.select({ publicId: schema.galleries.publicId }).from(schema.galleryPhotos)
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.galleryPhotos.galleryId))
    .innerJoin(schema.photos, eq(schema.photos.id, schema.galleryPhotos.photoId))
    .where(and(eq(schema.galleryPhotos.photoId, photoId), eq(schema.galleries.eventId, event.id), eq(schema.galleries.isArchived, 0), eq(schema.galleries.isIntake, 0), eq(schema.photos.renditionStatus, 'ready')))
    .orderBy(schema.galleries.sortOrder, schema.galleries.id).limit(1).get();
  if (!row) throw error(404, 'This photo is not available in the gallery yet');
  throw redirect(302, `/g/${event.slug}/c/${row.publicId}?photo=${photoId}`);
};
