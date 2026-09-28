import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { SidecarMetadata } from '../sidecars';
import type { SidecarKind } from '$shared/stem';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => text('created_at').notNull();

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull()
});

/** Immutable file locations; changing upload mode never reinterprets existing paths. No credentials. */
export const storageObjects = sqliteTable('storage_objects', {
  storagePath: text('storage_path').primaryKey(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  mime: text('mime').notNull(),
  localAvailable: integer('local_available').notNull().default(0),
  localVerifiedAt: text('local_verified_at'),
  remoteEndpoint: text('remote_endpoint'),
  remoteRegion: text('remote_region'),
  remoteBucket: text('remote_bucket'),
  remoteKey: text('remote_key'),
  remoteVersion: text('remote_version'),
  remoteVerifiedAt: text('remote_verified_at'),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull()
});

export const adminUsers = sqliteTable('admin_users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt()
});

export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt()
});

export const events = sqliteTable('events', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  subjectLabel: text('subject_label').notNull().default('child'),
  eventDate: text('event_date'),
  passwordHash: text('password_hash'),
  isPublished: integer('is_published').notNull().default(0),
  expiresAt: text('expires_at'),
  coverPhotoId: integer('cover_photo_id'),
  sharePhotoId: integer('share_photo_id'),
  shareUploadHash: text('share_upload_hash'),
  variantPolicy: text('variant_policy', { mode: 'json' }).$type<Record<string, 'free' | 'disabled' | 'paid'>>().notNull(),
  orderingEnabled: integer('ordering_enabled').notNull().default(1),
  catalogId: integer('catalog_id'),
  stemSuffixPatterns: text('stem_suffix_patterns', { mode: 'json' }).$type<Record<string, string> | null>(),
  notes: text('notes'),
  parentMessage: text('parent_message'),
  pickupInstructions: text('pickup_instructions'),
  tagline: text('tagline'),
  collectionCoverPolicy: text('collection_cover_policy').$type<'exclusive' | 'first'>().notNull().default('exclusive'),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull()
});

export const galleries = sqliteTable('galleries', {
  id: id(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id'),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  isArchived: integer('is_archived').notNull().default(0),
  isIntake: integer('is_intake').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  coverPhotoId: integer('cover_photo_id'),
  createdAt: createdAt()
}, (t) => [index('galleries_event_idx').on(t.eventId)]);

export const photos = sqliteTable('photos', {
  id: id(),
  galleryId: integer('gallery_id').notNull().references(() => galleries.id, { onDelete: 'cascade' }),
  stem: text('stem').notNull(),
  displayName: text('display_name').notNull(),
  takenAt: text('taken_at'),
  shootDay: integer('shoot_day').$type<1 | 2>(),
  width: integer('width'),
  height: integer('height'),
  renderSourceRole: text('render_source_role'),
  renditionStatus: text('rendition_status').notNull().default('pending'),
  renditionHash: text('rendition_hash'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('photos_gallery_stem_uq').on(t.galleryId, t.stem)]);

/** Collections are independent of storage: one moment can belong to siblings and friends. */
export const galleryPhotos = sqliteTable('gallery_photos', {
  galleryId: integer('gallery_id').notNull().references(() => galleries.id, { onDelete: 'cascade' }),
  photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' })
}, (t) => [uniqueIndex('gallery_photos_uq').on(t.galleryId, t.photoId), index('gallery_photos_photo_idx').on(t.photoId)]);

/** Project-defined tags are many-to-many; never a file identity or child collection. */
export const tags = sqliteTable('tags', {
  id: id(), eventId: integer('event_id').notNull().references(() => events.id, {onDelete:'cascade'}),
  publicId: text('public_id').notNull().unique(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => tags.id, {onDelete:'cascade'}),
  name: text('name').notNull(), shared: integer('shared').notNull().default(0),
  legacyDay: integer('legacy_day'), createdAt: createdAt()
});
export const photoTags = sqliteTable('photo_tags', {
  photoId: integer('photo_id').notNull().references(() => photos.id, {onDelete:'cascade'}),
  tagId: integer('tag_id').notNull().references(() => tags.id, {onDelete:'cascade'})
}, t => [uniqueIndex('photo_tags_uq').on(t.photoId,t.tagId)]);

export const photoFiles = sqliteTable('photo_files', {
  id: id(),
  photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  originalFilename: text('original_filename').notNull(),
  ext: text('ext').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  storagePath: text('storage_path').notNull(),
  downloadable: integer('downloadable').notNull().default(1),
  priceCents: integer('price_cents'),
  createdAt: createdAt()
}, (t) => [uniqueIndex('photo_files_photo_role_uq').on(t.photoId, t.role)]);

/** Lightroom originals remain private; these are deliberately separate from public photoFiles. */
export const photoSidecars = sqliteTable('photo_sidecars', {
  id: id(),
  photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<SidecarKind>().notNull(),
  originalFilename: text('original_filename').notNull(),
  ext: text('ext').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  storagePath: text('storage_path').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<SidecarMetadata>().notNull(),
  metadataWarning: text('metadata_warning'),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('photo_sidecars_photo_kind_uq').on(t.photoId, t.kind)]);

export const downloadTokens = sqliteTable('download_tokens', {
  token: text('token').primaryKey(),
  eventId: integer('event_id').notNull(),
  visitorSid: text('visitor_sid').notNull(),
  payload: text('payload', { mode: 'json' }).$type<{ photoIds: number[]; roles: string[] }>().notNull(),
  usesLeft: integer('uses_left').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt()
});

export const downloadLog = sqliteTable('download_log', {
  id: id(),
  eventId: integer('event_id').notNull(),
  galleryId: integer('gallery_id'),
  photoFileId: integer('photo_file_id'),
  role: text('role').notNull(),
  visitorSid: text('visitor_sid').notNull(),
  ip: text('ip'),
  createdAt: createdAt()
}, (t) => [index('download_log_event_idx').on(t.eventId)]);

export const catalogs = sqliteTable('catalogs', {
  id: id(),
  name: text('name').notNull(),
  isDefault: integer('is_default').notNull().default(0),
  currency: text('currency').notNull().default('USD')
});

export const printSizes = sqliteTable('print_sizes', {
  id: id(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  widthIn: real('width_in').notNull(),
  heightIn: real('height_in').notNull()
});

export const sheetTemplates = sqliteTable('sheet_templates', {
  id: id(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  paperWidthIn: real('paper_width_in').notNull(),
  paperHeightIn: real('paper_height_in').notNull()
});

export const sheetTemplateCells = sqliteTable('sheet_template_cells', {
  id: id(),
  sheetTemplateId: integer('sheet_template_id').notNull().references(() => sheetTemplates.id, { onDelete: 'cascade' }),
  cellIndex: integer('cell_index').notNull(),
  printSizeCode: text('print_size_code').notNull(),
  label: text('label').notNull(),
  xIn: real('x_in').notNull(),
  yIn: real('y_in').notNull(),
  wIn: real('w_in').notNull(),
  hIn: real('h_in').notNull(),
  rotation: integer('rotation').notNull().default(0),
  cellGroup: text('cell_group'),
  sizeOptions: text('size_options', { mode: 'json' }).$type<string[] | null>()
});

export const products = sqliteTable('products', {
  id: id(),
  catalogId: integer('catalog_id').notNull().references(() => catalogs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  costCents: integer('cost_cents'),
  allowMultiPose: integer('allow_multi_pose').notNull().default(1),
  active: integer('active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0)
});

export const productSheets = sqliteTable('product_sheets', {
  id: id(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sheetTemplateId: integer('sheet_template_id').notNull().references(() => sheetTemplates.id),
  sortOrder: integer('sort_order').notNull().default(0),
  label: text('label')
});

export const eventProducts = sqliteTable('event_products', {
  id: id(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  priceCentsOverride: integer('price_cents_override'),
  active: integer('active').notNull().default(1)
}, (t) => [uniqueIndex('event_products_uq').on(t.eventId, t.productId)]);

export const orders = sqliteTable('orders', {
  id: id(),
  orderNumber: text('order_number').notNull().unique(),
  accessToken: text('access_token').notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull(),
  intentHash: text('intent_hash'),
  eventId: integer('event_id').notNull().references(() => events.id),
  galleryId: integer('gallery_id'),
  photoRequests: text('photo_requests', {mode:'json'}).$type<Record<string,string>>().notNull().default({}),
  emailUpdates: integer('email_updates'),
  customerName: text('customer_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  subjectName: text('subject_name'),
  notes: text('notes'),
  adminNotes: text('admin_notes'),
  status: text('status').notNull().default('new'),
  subtotalCents: integer('subtotal_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull(),
  submittedIp: text('submitted_ip'),
  visitorSid: text('visitor_sid'),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('orders_event_idem_uq').on(t.eventId, t.idempotencyKey), index('orders_status_idx').on(t.status)]);

export const payments = sqliteTable('payments', {
  id: id(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('manual'),
  method: text('method').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reference: text('reference'),
  providerRef: text('provider_ref'),
  idempotencyKey: text('idempotency_key'),
  paidAt: text('paid_at').notNull(),
  createdAt: createdAt()
}, (t) => [uniqueIndex('payments_order_idem_uq').on(t.orderId, t.idempotencyKey)]);

export const orderItems = sqliteTable('order_items', {
  id: id(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id'),
  productCode: text('product_code').notNull(),
  productName: text('product_name').notNull(),
  productKind: text('product_kind').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0)
});

export const orderItemSheets = sqliteTable('order_item_sheets', {
  id: id(),
  orderItemId: integer('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'cascade' }),
  sheetIndex: integer('sheet_index').notNull(),
  templateCode: text('template_code').notNull(),
  label: text('label').notNull(),
  paperWidthIn: real('paper_width_in').notNull(),
  paperHeightIn: real('paper_height_in').notNull()
});

export const orderItemCells = sqliteTable('order_item_cells', {
  id: id(),
  orderItemSheetId: integer('order_item_sheet_id').notNull().references(() => orderItemSheets.id, { onDelete: 'cascade' }),
  cellIndex: integer('cell_index').notNull(),
  printSizeCode: text('print_size_code').notNull(),
  label: text('label').notNull(),
  wIn: real('w_in').notNull(),
  hIn: real('h_in').notNull(),
  xIn: real('x_in').notNull(),
  yIn: real('y_in').notNull(),
  rotation: integer('rotation').notNull().default(0),
  rotated: integer('rotated').notNull().default(0),
  sizeChoice: text('size_choice'),
  photoId: integer('photo_id'),
  photoStem: text('photo_stem').notNull(),
  galleryId: integer('gallery_id'),
  galleryName: text('gallery_name').notNull(),
  printSha256: text('print_sha256'),
  crop: text('crop', { mode: 'json' }).$type<Record<string, number> | null>()
});

export const orderEvents = sqliteTable('order_events', {
  id: id(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actor: text('actor').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: createdAt()
});

export const notificationChannels = sqliteTable('notification_channels', {
  id: id(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
  active: integer('active').notNull().default(1),
  createdAt: createdAt()
});

export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: id(),
  channelId: integer('channel_id'),
  eventType: text('event_type').notNull(),
  recipient: text('recipient'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at'),
  lastError: text('last_error'),
  responseCode: integer('response_code'),
  sentAt: text('sent_at'),
  createdAt: createdAt()
}, (t) => [index('deliveries_status_idx').on(t.status)]);

export const jobs = sqliteTable('jobs', {
  id: id(),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  priority: integer('priority').notNull().default(0),
  status: text('status').notNull().default('queued'),
  runAt: text('run_at').notNull(),
  lockedAt: text('locked_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: createdAt()
}, (t) => [index('jobs_status_run_idx').on(t.status, t.runAt)]);

export type Event = typeof events.$inferSelect;
export type Gallery = typeof galleries.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type PhotoFile = typeof photoFiles.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Job = typeof jobs.$inferSelect;

// Durable transport receipts and reversible organization operations are private to an owner.
export const uploadSessions = sqliteTable('upload_sessions', {
  id: text('id').primaryKey(), userId: integer('user_id').notNull().references(() => adminUsers.id, {onDelete:'cascade'}),
  eventId: integer('event_id').notNull().references(() => events.id, {onDelete:'cascade'}),
  fingerprint: text('fingerprint').notNull(), input: text('input').notNull(), bytes: integer('bytes').notNull(),
  result: text('result'), createdAt: createdAt(), expiresAt: text('expires_at').notNull()
}, t => [index('upload_sessions_recovery').on(t.userId,t.eventId,t.fingerprint)]);
export const organizationActions = sqliteTable('organization_actions', {
  id: text('id').primaryKey(), userId: integer('user_id').notNull().references(() => adminUsers.id,{onDelete:'cascade'}),
  eventId: integer('event_id').notNull().references(() => events.id,{onDelete:'cascade'}),
  intent: text('intent').notNull(), beforeState: text('before_state').notNull(), afterState: text('after_state').notNull(),
  result: text('result').notNull(), createdAt: createdAt(), undoneAt: text('undone_at')
});

export const orderFulfillment = sqliteTable('order_fulfillment', {
  orderId: integer('order_id').primaryKey().references(() => orders.id, { onDelete: 'cascade' }),
  extraRequests: text('extra_requests').notNull().default(''),
  requestsReviewed: integer('requests_reviewed').notNull().default(0),
  reviewedParentNotes: text('reviewed_parent_notes'), updatedAt: text('updated_at').notNull()
});
export const orderPhotoWork = sqliteTable('order_photo_work', {
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  photoKey: text('photo_key').notNull(), state: text('state').notNull(), note: text('note').notNull().default(''),
  reviewedSha256: text('reviewed_sha256'), updatedAt: text('updated_at').notNull()
}, (t) => [uniqueIndex('order_photo_work_unique').on(t.orderId, t.photoKey)]);
export const orderWorkActions = sqliteTable('order_work_actions', {
  id: text('id').primaryKey(), orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(), result: text('result', { mode: 'json' }).$type<{ message: string }>().notNull(), createdAt: createdAt()
});
