import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { getSettings } from './settings';
import { photoMatchKeys } from '$shared/photo-key';
import type { VariantRole } from '$shared/stem';
import { compareCollectionNames } from '$shared/collection-order';

/** The canonical gallery is only an event/storage anchor. Include sorted and archived photos
 * so a later rendition cannot accidentally create a second photo or restore a collection. */
export function listImportPhotos(eventId: number) {
  const event = db.select().from(schema.events).where(eq(schema.events.id, eventId)).get();
  const patterns = { ...getSettings().stemSuffixPatterns, ...(event?.stemSuffixPatterns ?? {}) } as Record<string, VariantRole>;
  const photos = db.select({ photo: schema.photos }).from(schema.photos)
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(eq(schema.galleries.eventId, eventId)).all();
  const files = db.select({ file: schema.photoFiles }).from(schema.photoFiles)
    .innerJoin(schema.photos, eq(schema.photos.id, schema.photoFiles.photoId))
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(eq(schema.galleries.eventId, eventId)).all();
  const sidecars = db.select({ sidecar: schema.photoSidecars }).from(schema.photoSidecars)
    .innerJoin(schema.photos, eq(schema.photos.id, schema.photoSidecars.photoId))
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId))
    .where(eq(schema.galleries.eventId, eventId)).all();
  const memberships = db.select({ photoId: schema.galleryPhotos.photoId, gallery: schema.galleries })
    .from(schema.galleryPhotos).innerJoin(schema.galleries, eq(schema.galleries.id, schema.galleryPhotos.galleryId))
    .where(eq(schema.galleries.eventId, eventId)).all();
  const fileMap = new Map<number, (typeof files)[number]['file'][]>();
  for (const { file } of files) {
    const group = fileMap.get(file.photoId) ?? []; group.push(file); fileMap.set(file.photoId, group);
  }
  const sidecarMap = new Map<number, (typeof sidecars)[number]['sidecar'][]>();
  for (const { sidecar } of sidecars) {
    const group = sidecarMap.get(sidecar.photoId) ?? []; group.push(sidecar); sidecarMap.set(sidecar.photoId, group);
  }
  const collectionMap = new Map<number, { id: number; name: string; isIntake: number; isArchived: number }[]>();
  for (const { photoId, gallery } of memberships) {
    const group = collectionMap.get(photoId) ?? [];
    group.push({ id: gallery.id, name: gallery.name, isIntake: gallery.isIntake, isArchived: gallery.isArchived });
    collectionMap.set(photoId, group);
  }
  return photos.map(({ photo }) => {
    const photoFiles = fileMap.get(photo.id) ?? [];
    const photoSidecars = sidecarMap.get(photo.id) ?? [];
    return { ...photo, files: photoFiles, sidecars: photoSidecars, matchKeys: photoMatchKeys({ stem: photo.stem, files: [...photoFiles.filter(f => f.origin === 'uploaded'), ...photoSidecars] }, patterns), collections: (collectionMap.get(photo.id) ?? []).sort(compareCollectionNames) };
  });
}
