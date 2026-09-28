import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getEvent, getGallery, listPhotos } from '$server/events';
import { listImportPhotos } from '$server/import-photos';

export const GET: RequestHandler = (e) => {
  if (!e.locals.admin) throw error(401, 'Please sign in first');
  e.setHeaders({ 'cache-control': 'private, no-store' });
  if (e.url.searchParams.get('import') === '1') {
    const eventId = Number(e.params.id);
    if (!getEvent(eventId)) throw error(404, 'Event not found');
    return json({ photos: listImportPhotos(eventId).map((p) => ({
      id: p.id, stem: p.stem, matchKeys: p.matchKeys, collections: p.collections,
      files: p.files.map((f) => ({ role: f.role, originalFilename: f.originalFilename })),
      sidecars: p.sidecars.map((f) => ({ kind: f.kind, originalFilename: f.originalFilename, sha256: f.sha256, metadata: f.metadata, metadataWarning: f.metadataWarning }))
    })) });
  }
  const g = getGallery(Number(e.url.searchParams.get('gallery')));
  if (!g || g.isArchived || g.eventId !== Number(e.params.id)) throw error(404, 'gallery not found');
  return json({ photos: listPhotos(g.id) });
};
