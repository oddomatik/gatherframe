/** Ordered SQL migrations. Never edit an applied entry; append a new one. Keep in sync with schema.ts. */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '0001_init',
    sql: `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, subject_label TEXT NOT NULL DEFAULT 'child',
  event_date TEXT, password_hash TEXT, is_published INTEGER NOT NULL DEFAULT 0, expires_at TEXT, cover_photo_id INTEGER,
  variant_policy TEXT NOT NULL, ordering_enabled INTEGER NOT NULL DEFAULT 1, catalog_id INTEGER, stem_suffix_patterns TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS galleries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, parent_id INTEGER,
  public_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, cover_photo_id INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS galleries_event_idx ON galleries(event_id);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE, stem TEXT NOT NULL,
  display_name TEXT NOT NULL, taken_at TEXT, width INTEGER, height INTEGER, render_source_role TEXT,
  rendition_status TEXT NOT NULL DEFAULT 'pending', rendition_hash TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS photos_gallery_stem_uq ON photos(gallery_id, stem);
CREATE TABLE IF NOT EXISTS photo_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE, role TEXT NOT NULL,
  original_filename TEXT NOT NULL, ext TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
  width INTEGER, height INTEGER, storage_path TEXT NOT NULL, downloadable INTEGER NOT NULL DEFAULT 1, price_cents INTEGER, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS photo_files_photo_role_uq ON photo_files(photo_id, role);
CREATE TABLE IF NOT EXISTS download_tokens (token TEXT PRIMARY KEY, event_id INTEGER NOT NULL, visitor_sid TEXT NOT NULL, payload TEXT NOT NULL, uses_left INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS download_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, gallery_id INTEGER, photo_file_id INTEGER, role TEXT NOT NULL, visitor_sid TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS download_log_event_idx ON download_log(event_id);
CREATE TABLE IF NOT EXISTS catalogs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD');
CREATE TABLE IF NOT EXISTS print_sizes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, width_in REAL NOT NULL, height_in REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sheet_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, paper_width_in REAL NOT NULL, paper_height_in REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sheet_template_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sheet_template_id INTEGER NOT NULL REFERENCES sheet_templates(id) ON DELETE CASCADE, cell_index INTEGER NOT NULL,
  print_size_code TEXT NOT NULL, label TEXT NOT NULL, x_in REAL NOT NULL, y_in REAL NOT NULL, w_in REAL NOT NULL, h_in REAL NOT NULL,
  rotation INTEGER NOT NULL DEFAULT 0, cell_group TEXT, size_options TEXT);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE, kind TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL, cost_cents INTEGER, allow_multi_pose INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS product_sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, sheet_template_id INTEGER NOT NULL REFERENCES sheet_templates(id), sort_order INTEGER NOT NULL DEFAULT 0, label TEXT);
CREATE TABLE IF NOT EXISTS event_products (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, price_cents_override INTEGER, active INTEGER NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS event_products_uq ON event_products(event_id, product_id);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE, access_token TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id), gallery_id INTEGER, customer_name TEXT NOT NULL, email TEXT, phone TEXT, subject_name TEXT,
  notes TEXT, admin_notes TEXT, status TEXT NOT NULL DEFAULT 'new', subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, currency TEXT NOT NULL,
  submitted_ip TEXT, visitor_sid TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS orders_event_idem_uq ON orders(event_id, idempotency_key);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, provider TEXT NOT NULL DEFAULT 'manual', method TEXT NOT NULL, amount_cents INTEGER NOT NULL, reference TEXT, provider_ref TEXT, paid_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER, product_code TEXT NOT NULL,
  product_name TEXT NOT NULL, product_kind TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_item_sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE, sheet_index INTEGER NOT NULL, template_code TEXT NOT NULL, label TEXT NOT NULL, paper_width_in REAL NOT NULL, paper_height_in REAL NOT NULL);
CREATE TABLE IF NOT EXISTS order_item_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_item_sheet_id INTEGER NOT NULL REFERENCES order_item_sheets(id) ON DELETE CASCADE, cell_index INTEGER NOT NULL,
  print_size_code TEXT NOT NULL, label TEXT NOT NULL, w_in REAL NOT NULL, h_in REAL NOT NULL, x_in REAL NOT NULL, y_in REAL NOT NULL,
  rotation INTEGER NOT NULL DEFAULT 0, rotated INTEGER NOT NULL DEFAULT 0, size_choice TEXT, photo_id INTEGER, photo_stem TEXT NOT NULL,
  gallery_id INTEGER, gallery_name TEXT NOT NULL, print_sha256 TEXT, crop TEXT);
CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, type TEXT NOT NULL, actor TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, events TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER, event_type TEXT NOT NULL, recipient TEXT, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, response_code INTEGER, sent_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS deliveries_status_idx ON notification_deliveries(status);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued',
  run_at TEXT NOT NULL, locked_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status_run_idx ON jobs(status, run_at);
`
  },
  { id: '0002_shared_collections_and_exact_intents', sql: `
ALTER TABLE galleries ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN is_intake INTEGER NOT NULL DEFAULT 0;
CREATE TABLE gallery_photos (gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE, photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE);
CREATE UNIQUE INDEX gallery_photos_uq ON gallery_photos(gallery_id, photo_id);
CREATE INDEX gallery_photos_photo_idx ON gallery_photos(photo_id);
INSERT INTO gallery_photos (gallery_id, photo_id) SELECT gallery_id, id FROM photos;
ALTER TABLE orders ADD COLUMN intent_hash TEXT;
ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX payments_order_idem_uq ON payments(order_id, idempotency_key);
` },
  { id: '0003_family_message', sql: 'ALTER TABLE events ADD COLUMN parent_message TEXT;' },
  { id: '0004_storage_objects', sql: `
CREATE TABLE storage_objects (
  storage_path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL,
  local_available INTEGER NOT NULL DEFAULT 0, local_verified_at TEXT,
  remote_endpoint TEXT, remote_region TEXT, remote_bucket TEXT, remote_key TEXT, remote_version TEXT,
  remote_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
` },
  { id: '0005_private_lightroom_sidecars', sql: `
CREATE TABLE photo_sidecars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('xmp', 'acr')),
  original_filename TEXT NOT NULL, ext TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, storage_path TEXT NOT NULL,
  metadata TEXT NOT NULL, metadata_warning TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX photo_sidecars_photo_kind_uq ON photo_sidecars(photo_id, kind);
` },
  { id: '0006_photo_shoot_day', sql: `
ALTER TABLE photos ADD COLUMN shoot_day INTEGER CHECK (shoot_day IS NULL OR shoot_day IN (1, 2));
` },
  { id: '0007_project_tag_hierarchy', sql: `
CREATE TABLE tags (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 public_id TEXT NOT NULL UNIQUE, parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
 name TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1)), legacy_day INTEGER,
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tags_siblings_uq ON tags(event_id, coalesce(parent_id,0), lower(name));
CREATE UNIQUE INDEX tags_legacy_uq ON tags(event_id,legacy_day) WHERE legacy_day IS NOT NULL;
CREATE TABLE photo_tags (photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
 tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(photo_id,tag_id));
CREATE INDEX photo_tags_tag_idx ON photo_tags(tag_id,photo_id);
-- Preserve only days that were actually used. New projects start with no tags.
INSERT INTO tags(event_id,public_id,name,shared,created_at)
 SELECT DISTINCT g.event_id, lower(hex(randomblob(12))), 'Days', 1, datetime('now')
 FROM photos p JOIN galleries g ON g.id=p.gallery_id WHERE p.shoot_day IS NOT NULL GROUP BY g.event_id;
INSERT INTO tags(event_id,public_id,parent_id,name,shared,legacy_day,created_at)
 SELECT DISTINCT g.event_id, lower(hex(randomblob(12))), t.id, 'Day '||p.shoot_day, 1,p.shoot_day,datetime('now')
 FROM photos p JOIN galleries g ON g.id=p.gallery_id JOIN tags t ON t.event_id=g.event_id AND t.parent_id IS NULL
 WHERE p.shoot_day IS NOT NULL GROUP BY g.event_id,t.id,p.shoot_day;
INSERT INTO photo_tags SELECT p.id,t.id FROM photos p JOIN galleries g ON g.id=p.gallery_id
 JOIN tags t ON t.event_id=g.event_id AND t.legacy_day=p.shoot_day;
` },
  { id: '0008_project_tagline', sql: 'ALTER TABLE events ADD COLUMN tagline TEXT;' },
  { id: '0009_collection_cover_policy', sql: "ALTER TABLE events ADD COLUMN collection_cover_policy TEXT NOT NULL DEFAULT 'exclusive' CHECK(collection_cover_policy IN ('exclusive','first'));" },
  { id: '0010_project_link_preview', sql: 'ALTER TABLE events ADD COLUMN share_photo_id INTEGER; ALTER TABLE events ADD COLUMN share_upload_hash TEXT;' },
  { id: '0011_transfer_and_sort_recovery', sql: `
CREATE TABLE upload_sessions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, input TEXT NOT NULL, bytes INTEGER NOT NULL, result TEXT,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX upload_sessions_recovery ON upload_sessions(user_id,event_id,fingerprint);
CREATE TABLE organization_actions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 intent TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL, result TEXT NOT NULL,
 created_at TEXT NOT NULL, undone_at TEXT
);
` },
  { id: '0012_print_fulfillment', sql: `
CREATE TABLE order_fulfillment (
 order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
 extra_requests TEXT NOT NULL DEFAULT '', requests_reviewed INTEGER NOT NULL DEFAULT 0,
 reviewed_parent_notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE order_photo_work (
 order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, photo_key TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('needs_review','needs_touchup','ready')),
 note TEXT NOT NULL DEFAULT '', reviewed_sha256 TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(order_id,photo_key)
);
CREATE TABLE order_work_actions (
 id TEXT PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 intent TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
);
` },
  { id: '0013_guest_experience', sql: `
ALTER TABLE events ADD COLUMN pickup_instructions TEXT;
ALTER TABLE orders ADD COLUMN photo_requests TEXT NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN email_updates INTEGER;
` },
  { id: '0014_guest_activity', sql: `
CREATE TABLE guest_activity (
 id TEXT PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 visitor TEXT NOT NULL, kind TEXT NOT NULL, gallery_id INTEGER REFERENCES galleries(id) ON DELETE SET NULL,
 photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
 channel TEXT, social_files INTEGER NOT NULL DEFAULT 0, print_files INTEGER NOT NULL DEFAULT 0,
 raw_files INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX guest_activity_event_time ON guest_activity(event_id,created_at);
CREATE INDEX guest_activity_time ON guest_activity(created_at);
CREATE TABLE activity_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO activity_meta VALUES ('started_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
` },
  { id: '0015_delivery_versions', sql: `
ALTER TABLE events ADD COLUMN display_source_role TEXT;
ALTER TABLE guest_activity ADD COLUMN other_files INTEGER NOT NULL DEFAULT 0;
CREATE TABLE delivery_versions (
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, key TEXT NOT NULL,
 label TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'uploaded' CHECK(mode IN ('uploaded','automatic')),
 source_role TEXT, recipe TEXT, filename_mode TEXT NOT NULL DEFAULT 'private' CHECK(filename_mode IN ('private','original')),
 folder TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX delivery_versions_event_key_uq ON delivery_versions(event_id,key);
INSERT INTO delivery_versions(event_id,key,label,sort_order,updated_at)
 SELECT id,'print','Full resolution',0,updated_at FROM events
 UNION ALL SELECT id,'social','Web size',1,updated_at FROM events
 UNION ALL SELECT id,'raw','Camera RAW',2,updated_at FROM events;
ALTER TABLE photo_files ADD COLUMN origin TEXT NOT NULL DEFAULT 'uploaded' CHECK(origin IN ('uploaded','generated'));
ALTER TABLE photo_files ADD COLUMN revision_id TEXT;
ALTER TABLE photo_files ADD COLUMN source_file_id INTEGER;
ALTER TABLE photo_files ADD COLUMN source_sha256 TEXT;
ALTER TABLE photo_files ADD COLUMN recipe_hash TEXT;
ALTER TABLE photo_files ADD COLUMN recipe TEXT;
ALTER TABLE photo_files ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
ALTER TABLE photo_files ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
CREATE TABLE photo_file_revisions (
 id TEXT PRIMARY KEY, photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
 role TEXT NOT NULL, storage_path TEXT NOT NULL, sha256 TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL
);
UPDATE photo_files SET revision_id='legacy-'||id;
INSERT INTO photo_file_revisions(id,photo_id,role,storage_path,sha256,snapshot,created_at)
 SELECT revision_id,photo_id,role,storage_path,sha256,
 json_object('originalFilename',original_filename,'ext',ext,'mime',mime,'bytes',bytes,'width',width,'height',height,'origin','uploaded'),created_at FROM photo_files;
CREATE TABLE delivery_states (
 photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE, role TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('queued','processing','ready','failed','waiting','paused','uploaded')),
 source_file_id INTEGER, source_sha256 TEXT, replace_upload_sha256 TEXT, recipe TEXT, recipe_hash TEXT, last_error TEXT, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX delivery_states_photo_role_uq ON delivery_states(photo_id,role);
INSERT INTO delivery_states(photo_id,role,status,updated_at) SELECT photo_id,role,'uploaded',created_at FROM photo_files;
` }
];
