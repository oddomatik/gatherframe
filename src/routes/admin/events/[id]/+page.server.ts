import { normalizeOrderReferenceLabel } from '$shared/terminology';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getEvent, getGallery, listGalleries, listPhotos, listEventPhotos, renameGallery, rotateSlug, setGalleryCover, updateEvent, photoEventId } from '$server/events';
import { addPhotosToCollections, archiveCollection, createCollection, mergeCollections, organizePhotos } from '$server/grouping';
import { hashPassword } from '$server/auth';
import { eventCatalog, listCatalogs, loadCatalog, setEventProduct } from '$server/catalog';
import { env } from '$server/env';
import { db, schema, sqlite } from '$server/db';
import { eq } from 'drizzle-orm';
import { dollarsToCents } from '$shared/money';
import { setPhotoShootDay } from '$server/shoot-days';
import { listTags, tagAssignments } from '$server/tags';
import { dayLabel } from '$shared/shoot-days';
import { photoRevision } from '$server/photo-state';
import { compareCollectionNames } from '$shared/collection-order';
import { linkPreview, readShareForm, saveLinkPreview } from '$server/link-preview';
import { isHttpError } from '@sveltejs/kit';

function load_(id: number) { const ev = getEvent(id); if (!ev) throw error(404, 'Event not found'); return ev; }
function ownGallery(eventId: number, galleryId: number) { const g = getGallery(galleryId); if (!g || g.eventId !== eventId || g.isArchived) throw error(404, 'Collection not found'); return g; }
export const load: PageServerLoad = (e) => {
  if (!e.locals.admin) throw error(401, 'Please sign in first');
  e.setHeaders({ 'cache-control': 'private, no-store' });
  const ev = load_(Number(e.params.id));
  const allGalleries = listGalleries(ev.id, true).sort(compareCollectionNames);
  const galleries = allGalleries.filter((g) => !g.isArchived);
  const selected = galleries.find((g) => g.id === Number(e.url.searchParams.get('g'))) ?? null;
  const allPhotos = listEventPhotos(ev.id);
  // Sidecar metadata stays on the authenticated owner page, never on the shared
  // event/photo loaders used for parent galleries, ordering, or media grants.
  const sidecars = db.select({ photoId: schema.photoSidecars.photoId, kind: schema.photoSidecars.kind,
    originalFilename: schema.photoSidecars.originalFilename, bytes: schema.photoSidecars.bytes,
    metadata: schema.photoSidecars.metadata, metadataWarning: schema.photoSidecars.metadataWarning,
    updatedAt: schema.photoSidecars.updatedAt
  }).from(schema.photoSidecars).innerJoin(schema.photos, eq(schema.photos.id, schema.photoSidecars.photoId))
    .innerJoin(schema.galleries, eq(schema.galleries.id, schema.photos.galleryId)).where(eq(schema.galleries.eventId, ev.id)).all();
  const byPhoto = new Map<number, typeof sidecars>();
  for (const sidecar of sidecars) { const rows = byPhoto.get(sidecar.photoId) ?? []; rows.push(sidecar); byPhoto.set(sidecar.photoId, rows); }
  const photos = (selected ? listPhotos(selected.id) : allPhotos).map((p) => ({ ...p, sidecars: byPhoto.get(p.id) ?? [] }));
  const base = loadCatalog(ev.catalogId, true);
  const overrides = db.select().from(schema.eventProducts).where(eq(schema.eventProducts.eventId, ev.id)).all();
  return {
    linkPreview: { ...linkPreview(ev), source: undefined },
    sharePhotos: allPhotos.filter(p => p.renditionStatus === 'ready' && p.collections.some(g => !g.isIntake)).map(p => ({ id: p.id, label: p.displayName, hash: p.renditionHash, collections: p.collections.filter(g => !g.isIntake).map(g => g.name).join(' · ') })),
    photoRevision: photoRevision(ev.id),
    event: { ...ev, passwordHash: ev.passwordHash ? 'set' : null }, galleries, archived: allGalleries.filter((g) => g.isArchived), selected, photos, publicOrigin: env.publicOrigin, tags: listTags(ev.id), tagAssignments: tagAssignments(ev.id), catalogs: listCatalogs(),
    readiness: { total: allPhotos.length, ready: allPhotos.filter((p) => p.renditionStatus === 'ready').length, failed: allPhotos.filter((p) => p.renditionStatus === 'failed').length, intake: galleries.filter((g) => g.isIntake).reduce((n, g) => n + g.photoCount, 0), missingPrint: allPhotos.filter((p) => !p.files.some((f) => f.role === 'print')).length },
    products: base.products.map((p) => { const o = overrides.find((x) => x.productId === p.id); return { id: p.id, name: p.name, code: p.code, priceCents: p.priceCents, active: p.active, overrideCents: o?.priceCentsOverride ?? null, eventActive: o ? !!o.active : true }; }),
    effectiveCount: eventCatalog(ev.id, ev.catalogId).catalog.products.length
  };
};
export const actions: Actions = {
  sharePreview: async (e) => {
    if (!e.locals.admin) throw error(401, 'Please sign in first');
    const ev = load_(Number(e.params.id));
    try { await saveLinkPreview(ev.id, await readShareForm(e.request)); return { ok: 'Link preview saved.' }; }
    catch (err) {
      if (isHttpError(err)) return fail(err.status, { error: err.body.message });
      return fail(400, { error: 'Could not save the preview. Your previous choice is unchanged; please retry.' });
    }
  },
  addToCollections: async (e) => {
    if (!e.locals.admin) throw error(401, 'Please sign in first');
    const ev = load_(Number(e.params.id)); const f = await e.request.formData();
    try {
      const result = addPhotosToCollections(ev.id, f.getAll('photoId').map(Number), f.getAll('targetId').map(Number));
      return { ok: `${result.count} photo${result.count === 1 ? '' : 's'} added to ${result.collections} collection${result.collections === 1 ? '' : 's'}. Other collection memberships are unchanged.`, organized: true };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not add photos to collections.' }); }
  },
  setShootDay: async (e) => {
    if (!e.locals.admin) throw error(401, 'Please sign in first');
    const ev = load_(Number(e.params.id));
    const f = await e.request.formData();
    try {
      if (!f.has('shootDay')) return fail(400, { error: 'Choose Day 1, Day 2, or Not labeled.' });
      const result = setPhotoShootDay(ev.id, f.getAll('photoId').map(Number), f.get('shootDay'));
      return { ok: `${result.count} photo${result.count === 1 ? '' : 's'} ${result.day === null ? 'returned to Not labeled' : `labeled ${dayLabel(result.day)}`}. Collections and files are unchanged.` };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not label photos.' }); }
  },
  update: async (e) => {
    const ev = load_(Number(e.params.id)); const f = await e.request.formData();
    try {
      const coverPolicy = f.has('collectionCoverPolicy') ? String(f.get('collectionCoverPolicy')) : ev.collectionCoverPolicy;
      if (coverPolicy !== 'exclusive' && coverPolicy !== 'first') return fail(400, { error: 'Choose a valid automatic cover rule.' });
      const policy = Object.fromEntries(['social', 'print', 'raw'].map((role) => [role, f.get(`p_${role}`) === 'free' ? 'free' : 'disabled'])) as Record<string, 'free' | 'disabled'>;
      let expiresAt: string | null = null;
      const local = String(f.get('expiresLocal') ?? '');
      if (local) {
        const offset = Number(f.get('timezoneOffset') ?? 0);
        const timestamp = new Date(`${local}Z`).getTime() + offset * 60_000;
        if (!Number.isFinite(timestamp) || !Number.isFinite(offset) || Math.abs(offset) > 900) return fail(400, { error: 'Choose a valid closing time.' });
        expiresAt = new Date(timestamp).toISOString();
      }
      updateEvent(ev.id, {
        name: String(f.get('name') ?? ev.name).trim() || ev.name, subjectLabel: f.has('subjectLabel') ? normalizeOrderReferenceLabel(String(f.get('subjectLabel') ?? '')) : ev.subjectLabel,
        tagline: f.has('tagline') ? String(f.get('tagline') ?? '').trim().slice(0, 180) || null : ev.tagline,
        collectionCoverPolicy: coverPolicy,
        eventDate: String(f.get('eventDate') ?? '') || null, expiresAt,
        isPublished: f.get('isPublished') ? 1 : 0, orderingEnabled: f.get('orderingEnabled') ? 1 : 0, variantPolicy: policy,
        pickupInstructions: f.has('pickupInstructions') ? String(f.get('pickupInstructions') ?? '').trim().slice(0,2000) || null : ev.pickupInstructions,
        catalogId: Number(f.get('catalogId')) || null, notes: String(f.get('notes') ?? '') || null, parentMessage: String(f.get('parentMessage') ?? '').trim().slice(0, 3000) || null
      });
      return { ok: 'Event settings saved.' };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Check the event settings.' }); }
  },
  password: async (e) => {
    const ev = load_(Number(e.params.id)); const f = await e.request.formData();
    if (f.get('clear')) { updateEvent(ev.id, { passwordHash: null }); return { ok: 'Password removed.' }; }
    const pw = String(f.get('password') ?? '');
    if (pw.length < 4) return fail(400, { error: 'Password must be at least 4 characters.' });
    updateEvent(ev.id, { passwordHash: await hashPassword(pw) }); return { ok: 'Password set.' };
  },
  rotate: async (e) => { rotateSlug(load_(Number(e.params.id)).id); return { ok: 'New event link generated. The old link no longer works.' }; },
  addGalleries: async (e) => {
    const ev = load_(Number(e.params.id)); const f = await e.request.formData();
    const names = String(f.get('names') ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const labels = names.length ? names.slice(0, 200) : [''];
    sqlite.transaction(() => { for (const label of labels) createCollection(ev.id, label); })();
    return { ok: `Created ${labels.length} collection${labels.length === 1 ? '' : 's'}. Private labels can be changed anytime.` };
  },
  renameGallery: async (e) => { const f = await e.request.formData(); const g = ownGallery(Number(e.params.id), Number(f.get('galleryId'))); const name = String(f.get('name') ?? '').trim(); if (name) renameGallery(g.id, name.slice(0, 120)); return { ok: 'Private label saved.' }; },
  organize: async (e) => {
    const f = await e.request.formData();
    try {
      const result = organizePhotos({ eventId: Number(e.params.id), photoIds: f.getAll('photoId').map(Number), targetId: Number(f.get('targetId')) || undefined, newLabel: String(f.get('newLabel') ?? ''), sourceId: Number(f.get('sourceId')) || undefined, mode: f.get('mode') === 'move' ? 'move' : 'add' });
      return { ok: `${result.count} photo${result.count === 1 ? '' : 's'} ${f.get('mode') === 'move' ? 'moved' : 'added'}. Original files and existing orders stay intact.`, organized: true };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not organize photos.' }); }
  },
  merge: async (e) => { const f = await e.request.formData(); try { const n = mergeCollections(Number(e.params.id), Number(f.get('sourceId')), Number(f.get('targetId'))); return { ok: `Combined ${n} photos. The source collection is archived and can be restored.` }; } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not combine collections.' }); } },
  archive: async (e) => { const f = await e.request.formData(); try { archiveCollection(Number(e.params.id), Number(f.get('galleryId')), f.get('restore') === '1'); return { ok: f.get('restore') ? 'Collection restored.' : 'Collection archived. Photos that needed a home are in To sort.' }; } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not archive collection.' }); } },
  setCover: async (e) => {
    if (!e.locals.admin) throw error(401, 'Please sign in first');
    const f = await e.request.formData(); const g = ownGallery(Number(e.params.id), Number(f.get('galleryId')));
    if (g.isIntake) return fail(400, { error: 'Choose a collection.' });
    const photoId = f.get('photoId') === '' ? null : Number(f.get('photoId'));
    if (!f.has('photoId') || (photoId !== null && (!Number.isSafeInteger(photoId) || photoId <= 0))) return fail(400, { error: 'Choose a photo or use automatic cover.' });
    return setGalleryCover(g.id, photoId) ? { ok: photoId === null ? 'Automatic cover restored.' : 'Cover pinned.' } : fail(400, { error: 'Choose a ready photo from this collection.' });
  },
  eventCover: async (e) => { const ev = load_(Number(e.params.id)); const f = await e.request.formData(); const pid = Number(f.get('photoId')) || null; if (pid && photoEventId(pid) !== ev.id) return fail(400, { error: 'Choose a photo from this event.' }); updateEvent(ev.id, { coverPhotoId: pid }); return { ok: 'Event cover chosen.' }; },
  overrides: async (e) => {
    const ev = load_(Number(e.params.id)); const f = await e.request.formData();
    try {
      const products = loadCatalog(ev.catalogId, true).products;
      const updates = products.map((p) => { const raw = String(f.get(`price_${p.id}`) ?? '').trim(); const cents = raw ? dollarsToCents(raw) : null; if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0)) throw new Error('Prices must be zero or more.'); return { id: p.id, cents, active: f.get(`active_${p.id}`) === 'on' }; });
      sqlite.transaction(() => { for (const p of updates) setEventProduct(ev.id, p.id, { priceCentsOverride: p.cents, active: p.active }); })();
      return { ok: 'Event pricing saved. Blank prices follow your catalog.' };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Check the prices.' }); }
  }
};
