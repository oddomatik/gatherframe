import { redirect } from '@sveltejs/kit';
import { demoEnabled } from '$server/demo';
import { db, schema } from '$server/db';
import { eq } from 'drizzle-orm';
import { mediaUrl } from '$server/media-access';
export const load = () => {
  if (!demoEnabled) throw redirect(302, '/admin');
  const event = db.select().from(schema.events).where(eq(schema.events.slug, 'field-notes')).get();
  if (!event?.isPublished || event.passwordHash) throw new Error('Demo gallery is unavailable');
  const photos = db.select().from(schema.photos).all();
  const collections = db.select().from(schema.galleries).where(eq(schema.galleries.eventId, event.id)).all().filter(g => !g.isIntake && !g.isArchived);
  return {
    hero: mediaUrl(event, event.sharePhotoId!, 'cover1440'),
    count: photos.length,
    collections: collections.map(g => ({ name:g.name, href:`/g/${event.slug}/c/${g.publicId}`, cover:mediaUrl(event, g.coverPhotoId!, 'cover960'), count:db.select().from(schema.galleryPhotos).where(eq(schema.galleryPhotos.galleryId,g.id)).all().length }))
  };
};
