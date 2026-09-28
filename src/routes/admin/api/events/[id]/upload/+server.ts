import { json, type RequestHandler } from '@sveltejs/kit';
import { StorageError } from '$server/blob-store';
import { IngestError, ingestUpload } from '$server/ingest';
import { UPLOAD_ROLES, type UploadRole } from '$shared/stem';
import { parseShootDay, type ShootDay } from '$shared/shoot-days';

export const PUT: RequestHandler = async (e) => {
  const q = e.url.searchParams;
  const role = q.get('role');
  let shootDay: ShootDay | null;
  try { shootDay = parseShootDay(q.get('shootDay')); } catch (err) { return json({ error: (err as Error).message }, { status: 400 }); }
  try {
    const r = await ingestUpload({
      eventId: Number(e.params.id), galleryId: Number(q.get('gallery')), filename: q.get('filename') ?? 'upload',
      role: role && UPLOAD_ROLES.includes(role as UploadRole) ? (role as UploadRole) : null,
      body: e.request.body, declaredBytes: Number(e.request.headers.get('content-length')) || null,
      longEdgePx: Number(q.get('longEdge')) || null,
      shootDay, tagIds: (q.get("tags") ?? "").split(",").filter(Boolean).map(Number),
      replacement: q.get('replacement') === 'replace' ? 'replace' : 'reject', stemOverride: q.get('stemOverride') || undefined
    });
    return json(r);
  } catch (err) {
    if (err instanceof IngestError) return json({ error: err.message }, { status: err.status });
    if (err instanceof StorageError) return json({ error: err.message }, { status: err.code === 'disk_full' ? 507 : ['not_tested', 'not_configured', 'immutable_conflict'].includes(err.code) ? 409 : 503 });
    console.error('[upload]', err);
    return json({ error: 'upload failed' }, { status: 500 });
  }
};
