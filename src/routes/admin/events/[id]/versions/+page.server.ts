import { error, fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getEvent, listEventPhotos } from '$server/events';
import { db, schema, sqlite } from '$server/db';
import { listDeliveryVersions, saveDeliveryVersion, deliveryOverview, backfillCandidates, queueDeliveryBatch,
  requestGeneration, pauseDelivery, pausePendingDeliveries, acknowledgeVersion, assertPhotoProject, currentFile } from '$server/delivery';
import { retryPhotoRendering } from '$server/images';
import { DEFAULT_DELIVERY_RECIPE } from '$shared/delivery';

function own(id: string | undefined) {
  const event = getEvent(Number(id)); if (!event) throw error(404, 'Project not found'); return event;
}
export const load: PageServerLoad = e => {
  if (!e.locals.admin) throw error(401, 'Please sign in');
  e.setHeaders({ 'cache-control': 'private, no-store' });
  const event = own(e.params.id), versions = listDeliveryVersions(event.id);
  return { event: { id: event.id, name: event.name, variantPolicy: event.variantPolicy, displaySourceRole: event.displaySourceRole },
    versions, defaults: DEFAULT_DELIVERY_RECIPE, overview: deliveryOverview(event.id),
    backfills: Object.fromEntries(versions.filter(v => v.mode === 'automatic').map(v => [v.key, backfillCandidates(event.id, v.key)])),
    samples: listEventPhotos(event.id).filter(p => p.files.some(f => f.ext === 'jpg' || f.ext === 'jpeg')).slice(0, 100).map(p => ({ id:p.id, label:p.displayName, roles:p.files.filter(f => f.origin !== 'generated').map(f => f.role) })) };
};
function versionForm(f: FormData) {
  const size = Number(f.get('longEdge') || 2560), box = f.get('sizeMode') === 'box';
  return { ...(f.get('key') ? { key: String(f.get('key')) } : {}), label: String(f.get('label') ?? ''), mode: String(f.get('mode')),
    sourceRole: String(f.get('sourceRole') || 'print'), filenameMode: String(f.get('filenameMode') || 'private'),
    folder: String(f.get('folder') ?? ''), access: String(f.get('access') || 'disabled'),
    recipe: { schema: 1, width: box ? Number(f.get('width')) : size, height: box ? Number(f.get('height')) : size,
      quality: Number(f.get('quality') || 85), sharpening: String(f.get('sharpening') || 'none'), metadata: String(f.get('metadata') || 'none') } };
}
function failure(err: unknown) {
  return fail(400, { error: err instanceof ZodError ? err.issues[0]?.message ?? 'Check the version settings.' : err instanceof Error ? err.message : 'Could not update delivery versions.' });
}
export const actions: Actions = {
  save: async e => {
    const event = own(e.params.id);
    try { const version = saveDeliveryVersion(event.id, versionForm(await e.request.formData())); return { ok: `${version.label} saved. Existing files were not re-rendered; use the batch controls to apply new processing settings.` }; }
    catch (err) { return failure(err); }
  },
  batch: async e => {
    const event = own(e.params.id), f = await e.request.formData();
    try {
      if (f.get('reviewed') !== 'yes') throw new Error('Review the batch before generating copies.');
      const n = queueDeliveryBatch(event.id, String(f.get('key')), f.getAll('photoId').map(Number));
      return { ok: `${n} copies queued. Uploaded overrides are unchanged.` };
    } catch (err) { return failure(err); }
  },
  pauseBatch: async e => {
    const event = own(e.params.id), f = await e.request.formData();
    try { const count = pausePendingDeliveries(event.id,String(f.get('key'))); return { ok:`${count} pending copies paused. Published files are unchanged.` }; }
    catch (err) { return failure(err); }
  },
  photo: async e => {
    const event = own(e.params.id), f = await e.request.formData(), photoId = Number(f.get('photoId')), key = String(f.get('key'));
    try {
      const message = sqlite.transaction(() => {
        assertPhotoProject(event.id, photoId);
        if (f.get('intent') === 'pause') { pauseDelivery(event.id, photoId, key); return 'Processing paused. Published files are unchanged.'; }
        if (f.get('intent') === 'review') { acknowledgeVersion(event.id, photoId, key); return 'Uploaded version kept.'; }
        const file = currentFile(photoId, key);
        if (file?.origin === 'uploaded' && (f.get('replaceUpload') !== 'yes' || f.get('expectedSha256') !== file.sha256)) throw new Error('Confirm this exact uploaded version before resuming automatic copies.');
        const queued = requestGeneration(event.id, photoId, key, { resume: true, ...(file?.origin === 'uploaded' ? { replaceUploadSha256:file.sha256 } : {}) });
        return queued ? 'Copy queued. Your current uploaded file stays available until the replacement is ready.' : 'No copy queued. Check that the source is uploaded and this version is automatic.';
      })();
      return { ok: message };
    } catch (err) { return failure(err); }
  },
  display: async e => {
    const event = own(e.params.id), f = await e.request.formData(), role = String(f.get('displaySourceRole') || '');
    try {
      if (role && !listDeliveryVersions(event.id).some(v => v.key === role && v.mode === 'uploaded')) throw new Error('Choose an uploaded display source.');
      sqlite.transaction(() => {
        db.update(schema.events).set({ displaySourceRole: role || null }).where(eq(schema.events.id, event.id)).run();
        for (const p of listEventPhotos(event.id)) retryPhotoRendering(p.id);
      })();
      return { ok: 'Gallery previews queued from the selected source. Downloads are unchanged.' };
    } catch (err) { return failure(err); }
  }
};
