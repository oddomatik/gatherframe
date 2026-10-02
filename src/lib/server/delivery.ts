/** Application boundary shared by browser imports, jobs and future connectors. */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { and, eq, asc } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import { nowIso } from './env';
import { randomId } from './ids';
import { enqueue } from './jobs';
import { safeSegment } from './zip';
import { DEFAULT_DELIVERY_RECIPE, LEGACY_VERSIONS, versionInputSchema, type DeliveryRecipe } from '$shared/delivery';
import type { PhotoFile } from './db/schema';

export type DeliveryVersion = typeof schema.deliveryVersions.$inferSelect;
export const DELIVERY_RENDERER = `jpeg-srgb-v1-sharp${sharp.versions.sharp}-vips${sharp.versions.vips}`;
export function recipeHash(recipe: DeliveryRecipe): string {
  return createHash('sha256').update(JSON.stringify({ renderer: DELIVERY_RENDERER, ...recipe })).digest('hex');
}
export function listDeliveryVersions(eventId: number): DeliveryVersion[] {
  const saved = db.select().from(schema.deliveryVersions).where(eq(schema.deliveryVersions.eventId, eventId)).orderBy(asc(schema.deliveryVersions.sortOrder)).all();
  // Compatibility for fixture/import-created projects; reads never mutate a guest request.
  const missing = LEGACY_VERSIONS.filter(v => !saved.some(s => s.key === v.key)).map((v, i) => ({
    eventId, ...v, mode: 'uploaded' as const, sourceRole: null, recipe: null, filenameMode: 'private' as const,
    folder: '', sortOrder: i, updatedAt: ''
  }));
  return [...saved, ...missing].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}
export function ensureDeliveryVersions(eventId: number): void {
  for (const v of listDeliveryVersions(eventId)) db.insert(schema.deliveryVersions).values({ ...v, updatedAt: v.updatedAt || nowIso() }).onConflictDoNothing().run();
}
export function versionFor(eventId: number, key: string): DeliveryVersion | undefined {
  return listDeliveryVersions(eventId).find(v => v.key === key);
}
function photoProject(photoId: number): number | undefined {
  return (sqlite.prepare('SELECT g.event_id id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.id=?').get(photoId) as { id: number } | undefined)?.id;
}
export function assertPhotoProject(eventId: number, photoId: number): void {
  if (photoProject(photoId) !== eventId) throw new Error('Photo not found in this project.');
}
export function saveDeliveryVersion(eventId: number, raw: unknown): DeliveryVersion {
  const input = versionInputSchema.parse(raw);
  return sqlite.transaction(() => {
    const event = db.select().from(schema.events).where(eq(schema.events.id, eventId)).get();
    if (!event) throw new Error('Project not found.');
    ensureDeliveryVersions(eventId);
    const all = listDeliveryVersions(eventId), key = input.key ?? `v_${randomId(16)}`;
    if (input.key && !all.some(v => v.key === key)) throw new Error('Version not found in this project.');
    if (!input.key && all.length >= 20) throw new Error('A project can have up to 20 delivery versions.');
    if (all.some(v => v.key !== key && v.label.toLocaleLowerCase() === input.label.toLocaleLowerCase())) throw new Error('Choose a distinct version name.');
    if (input.folder && all.some(v => v.key !== key && v.folder.toLocaleLowerCase() === input.folder.toLocaleLowerCase())) throw new Error('That export folder is already mapped to another version.');
    if (input.mode === 'automatic') {
      if (key === 'print' || key === 'raw') throw new Error('Print masters and camera RAW must be supplied by upload.');
      const source = all.find(v => v.key === input.sourceRole);
      if (!source || source.key === key || source.key === 'raw' || source.mode !== 'uploaded') throw new Error('Choose an uploaded finished-image version as the source.');
      if (all.some(v => v.sourceRole === key && v.mode === 'automatic')) throw new Error('This version supplies other automatic copies. Keep it uploaded or change their source first.');
    }
    const old = all.find(v => v.key === key);
    const values = { label: input.label, mode: input.mode, sourceRole: input.mode === 'automatic' ? input.sourceRole : null,
      recipe: input.mode === 'automatic' ? input.recipe ?? DEFAULT_DELIVERY_RECIPE : null,
      filenameMode: input.filenameMode, folder: input.folder, updatedAt: nowIso() };
    if (old) db.update(schema.deliveryVersions).set(values).where(and(eq(schema.deliveryVersions.eventId, eventId), eq(schema.deliveryVersions.key, key))).run();
    else db.insert(schema.deliveryVersions).values({ eventId, key, ...values, sortOrder: all.length }).run();
    db.update(schema.events).set({ variantPolicy: { ...event.variantPolicy, [key]: input.access }, updatedAt: nowIso() }).where(eq(schema.events.id, eventId)).run();
    if (input.mode === 'uploaded') {
      sqlite.prepare(`UPDATE delivery_states SET generation=generation+1,status='paused',updated_at=? WHERE role=? AND status NOT IN ('uploaded','ready','paused')
        AND photo_id IN (SELECT p.id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE g.event_id=?)`).run(nowIso(), key, eventId);
    }
    return versionFor(eventId, key)!;
  })();
}

/** Store exact provenance once; updating a current slot never edits its old revision. */
export function archiveFileRevision(file: PhotoFile): string {
  if (file.revisionId && db.select({ id: schema.photoFileRevisions.id }).from(schema.photoFileRevisions).where(eq(schema.photoFileRevisions.id, file.revisionId)).get()) return file.revisionId;
  const id = randomId(24);
  db.insert(schema.photoFileRevisions).values({ id, photoId: file.photoId, role: file.role, storagePath: file.storagePath,
    sha256: file.sha256, snapshot: { ...file, renderer: file.origin === 'generated' ? DELIVERY_RENDERER : null }, createdAt: nowIso() }).run();
  db.update(schema.photoFiles).set({ revisionId: id }).where(eq(schema.photoFiles.id, file.id)).run();
  return id;
}
export function currentFile(photoId: number, role: string) {
  return db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.photoId, photoId), eq(schema.photoFiles.role, role))).get();
}
export function fileIsCurrent(file: Pick<PhotoFile, 'id' | 'role'> & Partial<Pick<PhotoFile, 'photoId' | 'available' | 'origin' | 'sourceFileId' | 'sourceSha256'>>): boolean {
  if (file.available === 0) return false;
  if (file.origin !== 'generated') return true;
  if (!file.photoId) return false;
  const source = file.sourceFileId && db.select().from(schema.photoFiles).where(and(eq(schema.photoFiles.id, file.sourceFileId), eq(schema.photoFiles.photoId, file.photoId))).get();
  return !!source && source.origin === 'uploaded' && !!source.available && source.sha256 === file.sourceSha256;
}
export function deliveryFilename(file: Pick<PhotoFile, 'photoId' | 'role' | 'ext' | 'originalFilename'>, version?: DeliveryVersion): string {
  return version?.filenameMode === 'original' ? safeSegment(file.originalFilename) : `photo-${file.photoId}-${file.role}.${file.ext}`;
}

function stateFor(photoId: number, role: string) {
  return db.select().from(schema.deliveryStates).where(and(eq(schema.deliveryStates.photoId, photoId), eq(schema.deliveryStates.role, role))).get();
}
function writeState(photoId: number, role: string, values: Omit<typeof schema.deliveryStates.$inferInsert, 'photoId' | 'role'>) {
  db.insert(schema.deliveryStates).values({ photoId, role, ...values }).onConflictDoUpdate({ target: [schema.deliveryStates.photoId, schema.deliveryStates.role], set: values }).run();
}
export function requestGeneration(eventId: number, photoId: number, key: string, opts: { resume?: boolean; priority?: number; replaceUploadSha256?: string } = {}): boolean {
  return sqlite.transaction(() => requestGenerationInTransaction(eventId,photoId,key,opts))();
}
function requestGenerationInTransaction(eventId:number,photoId:number,key:string,opts:{resume?:boolean;priority?:number;replaceUploadSha256?:string}):boolean {
  assertPhotoProject(eventId, photoId);
  const version = versionFor(eventId, key);
  if (!version || version.mode !== 'automatic' || !version.sourceRole || !version.recipe) return false;
  const file = currentFile(photoId, key), state = stateFor(photoId, key);
  const replaceUploadSha256 = opts.replaceUploadSha256 ?? state?.replaceUploadSha256 ?? null;
  if ((file?.origin === 'uploaded' && file.sha256 !== replaceUploadSha256) || (state?.status === 'paused' && !opts.resume)) return false;
  const source = currentFile(photoId, version.sourceRole), hash = recipeHash(version.recipe);
  if (!source || source.origin !== 'uploaded' || !source.available) {
    writeState(photoId, key, { generation: (state?.generation ?? 0) + 1, status: 'waiting', recipe: version.recipe, recipeHash: hash, sourceFileId: null, sourceSha256: null, lastError: 'Upload the selected source version first.', updatedAt: nowIso() });
    return false;
  }
  if (file && fileIsCurrent(file) && file.sourceFileId === source.id && file.sourceSha256 === source.sha256 && file.recipeHash === hash) return false;
  if (state && ['queued', 'processing'].includes(state.status) && state.sourceFileId === source.id && state.sourceSha256 === source.sha256 && state.recipeHash === hash) return false;
  archiveFileRevision(source);
  const generation = (state?.generation ?? 0) + 1;
  writeState(photoId, key, { generation, status: 'queued', sourceFileId: source.id, sourceSha256: source.sha256, replaceUploadSha256, recipe: version.recipe, recipeHash: hash, lastError: null, updatedAt: nowIso() });
  enqueue('render_delivery', { eventId, photoId, role: key, generation }, { dedupeKey: `delivery:${photoId}:${key}:${generation}`, priority: opts.priority ?? 2 });
  return true;
}

/** Called inside the upload/delete transaction, after the current slot changes. */
export function deliverySourceChanged(photoId: number, changedRole: string, changed: boolean): void {
  const eventId = photoProject(photoId); if (!eventId) return;
  const file = currentFile(photoId, changedRole);
  const state = stateFor(photoId, changedRole);
  if (file?.origin === 'uploaded') {
    archiveFileRevision(file);
    writeState(photoId, changedRole, { generation: (state?.generation ?? 0) + 1, status: 'uploaded', replaceUploadSha256: null, sourceFileId: null, sourceSha256: null, recipe: null, recipeHash: null, lastError: null, updatedAt: nowIso() });
  }
  const files = db.select().from(schema.photoFiles).where(eq(schema.photoFiles.photoId, photoId)).all();
  const invalidated = new Set<string>();
  for (const candidate of files) if (candidate.origin === 'generated' && !fileIsCurrent(candidate)) {
    invalidated.add(candidate.role);
    db.update(schema.photoFiles).set({ available: 0 }).where(eq(schema.photoFiles.id, candidate.id)).run();
  }
  const definitions = listDeliveryVersions(eventId);
  if (changed && (changedRole === 'print' || definitions.some(v => v.sourceRole === changedRole))) {
    sqlite.prepare("UPDATE photo_files SET needs_review=1 WHERE photo_id=? AND role NOT IN (?, 'raw') AND origin='uploaded'").run(photoId, changedRole);
  }
  for (const v of definitions) if (v.mode === 'automatic' && (v.sourceRole === changedRole || invalidated.has(v.key))) requestGeneration(eventId, photoId, v.key);
}

export function deliveryOverview(eventId: number) {
  return sqlite.prepare(`SELECT p.id photoId, p.display_name name, s.role, s.status, s.last_error error, s.generation,
    f.origin, f.sha256, f.needs_review needsReview, f.width, f.height, f.bytes FROM photos p JOIN galleries g ON g.id=p.gallery_id
    JOIN delivery_states s ON s.photo_id=p.id LEFT JOIN photo_files f ON f.photo_id=p.id AND f.role=s.role
    WHERE g.event_id=? ORDER BY p.id,s.role`).all(eventId) as {
      photoId: number; name: string; role: string; status: string; error: string | null; generation: number;
      origin: string | null; sha256: string | null; needsReview: number | null; width: number | null; height: number | null; bytes: number | null
    }[];
}
export function backfillCandidates(eventId: number, key: string): { photoId: number; name: string }[] {
  const v = versionFor(eventId, key);
  if (!v?.recipe || !v.sourceRole || v.mode !== 'automatic') return [];
  const hash = recipeHash(v.recipe);
  return (sqlite.prepare(`SELECT p.id photoId, p.display_name name FROM photos p JOIN galleries g ON g.id=p.gallery_id
    JOIN photo_files source ON source.photo_id=p.id AND source.role=? AND source.origin='uploaded' AND source.available=1
    LEFT JOIN photo_files target ON target.photo_id=p.id AND target.role=?
    LEFT JOIN delivery_states s ON s.photo_id=p.id AND s.role=?
    WHERE g.event_id=? AND (target.id IS NULL OR target.origin='generated') AND coalesce(s.status,'') NOT IN ('paused','queued','processing')
    AND (target.id IS NULL OR target.available=0 OR target.source_file_id!=source.id OR target.source_sha256!=source.sha256 OR target.recipe_hash!=?)
    ORDER BY p.id`).all(v.sourceRole, key, key, eventId, hash) as { photoId: number; name: string }[]);
}
export function queueDeliveryBatch(eventId: number, key: string, ids: number[]): number {
  if (!ids.length || ids.length > 500) throw new Error('Select between 1 and 500 photos per batch.');
  return sqlite.transaction(() => [...new Set(ids)].reduce((n, id) => n + Number(requestGeneration(eventId, id, key, { priority: 0 })), 0))();
}
/** Pausing cancels publication without deleting an already-accepted output. */
export function pauseDelivery(eventId: number, photoId: number, role: string): void {
  assertPhotoProject(eventId, photoId);
  const old = stateFor(photoId, role);
  writeState(photoId, role, { generation: (old?.generation ?? 0) + 1, status: 'paused', replaceUploadSha256: null, updatedAt: nowIso() });
}
export function pausePendingDeliveries(eventId: number, role: string): number {
  if (!versionFor(eventId,role)) throw new Error('Version not found in this project.');
  return sqlite.prepare(`UPDATE delivery_states SET generation=generation+1,status='paused',replace_upload_sha256=NULL,updated_at=?
    WHERE role=? AND status IN ('queued','processing','waiting','failed') AND photo_id IN
    (SELECT p.id FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE g.event_id=?)`).run(nowIso(),role,eventId).changes;
}
export function acknowledgeVersion(eventId: number, photoId: number, role: string): void {
  assertPhotoProject(eventId, photoId);
  db.update(schema.photoFiles).set({ needsReview: 0 }).where(and(eq(schema.photoFiles.photoId, photoId), eq(schema.photoFiles.role, role))).run();
}
