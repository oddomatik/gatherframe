# Delivery versions

Gatherframe accepts photographer-authored versions and can optionally generate smaller downloadable JPEGs. These choices can coexist in the same project, even for individual photos.

## Photographer workflow

Open a project → **Settings → Manage delivery versions & automatic copies**, or follow **Delivery versions & automatic copies** from Upload photos.

- **Use my exports** delivers the uploaded file bytes unchanged. Lightroom controls dimensions, sharpening, color, crops and embedded metadata. Give versions your own labels and optionally map an export folder name to each version.
- **Create smaller copies** makes an SDR sRGB JPEG from a selected uploaded finished-image version. Defaults are 2560 px maximum long edge, quality 85, no enlargement/crop/extra sharpening, and stripped metadata. Override dimensions with a long edge or maximum width/height box. Optional light screen sharpening and artist/copyright retention are available. These settings are not equivalents of Lightroom's quality/sharpening scales or universal platform requirements.
- **Uploaded overrides** take precedence. Replacing an existing file requires the importer's explicit replacement choice. An automatic job never silently replaces a custom export. To return to automatic copies, confirm the exact uploaded revision in the version's photo controls; it stays available until the replacement succeeds.

Use the sample preview before saving an automatic recipe. It reports actual dimensions and bytes and offers a 100% detail view. It does not save a deliverable. Automatic inputs currently require conventional 8-bit SDR JPEGs up to 100 megapixels, not RAW previews, PNG/TIFF or HDR gain maps. Unsupported sources fail visibly and can be supplied as custom exports instead. Output bounds are 320–8192 pixels per axis; smaller sources are never enlarged. Up to 20 named versions are supported per project.

Saving a version does **not** generate copies for existing photos. Review the existing-photo batch, select up to 500 photos, and explicitly queue it. Repeat for larger projects. Uploaded overrides and paused photos are excluded. New uploads to the configured source automatically queue eligible copies.

Download visibility is independent of the source. A private full-resolution file can supply an available Web copy without exposing the source. Existing free/hidden/paid policies are preserved; this feature does not implement new paid-download fulfillment.

Version labels, stable IDs and download filenames are different things. Anonymous photo numbers remain the default. Selecting **Use uploaded filename** exposes that name to guests deliberately. Filenames are sanitized and duplicate ZIP names get unique suffixes. Generated files use generated names, never a private source filename.

Matching basenames across export folders remain the simplest import contract. Different edits retain their suffixes; folder names never become photo identity. Arbitrarily renamed files need explicit matching; this release does not guess relationships from image similarity or include a Lightroom connector/manifest importer.

## Replacement and recovery

- A changed source invalidates its old generated downloads immediately and queues replacements for enabled, unpaused versions. Individual and ZIP endpoints reject stale files; they never substitute the full-size source.
- Uploaded companions remain byte-for-byte intact and can be marked for review. Use **Keep this uploaded version** to acknowledge them.
- Saving a new recipe affects future work. Existing accepted copies keep their recipe provenance until explicitly backfilled. While a new recipe renders from the same source, the previous accepted copy can remain available.
- Pause fences in-flight work without removing an accepted output. A version's **Pause all pending copies** stops its current batch. Removing a file does not silently recreate it; resumption is explicit.
- Failed processing has targeted retry controls. Durable queue work survives a process restart. Missing sources are shown as waiting rather than as successfully generated output.
- Gallery display source is an independent advanced setting. Internal browsing WebP derivatives remain separate from downloads. Print production continues using the explicitly designated legacy `print` slot, even if renamed; this release does not reassign existing print masters.

## Architecture and integration contract

`src/lib/server/delivery.ts` is the application boundary for version definitions, source changes, explicit generation, batch requests, overrides and current-file resolution. `delivery-render.ts` is the processing implementation. Shared validation lives in `src/lib/shared/delivery.ts`.

IDs are scoped to a project. Legacy `print`, `social`, `raw` keys remain stable IDs for backward compatibility; new IDs are opaque `v_…` keys. The existing `photo_files.role` column now stores this version key. Labels and folders do not identify files. The existing event `variantPolicy` map remains the one authoritative access-policy store, keyed by those IDs; definitions do not introduce a competing policy map.

Existing file IDs remain current-slot URLs. Immutable revision records snapshot historical files and provenance without moving or re-encoding media. Current slots store uploaded/generated origin, input file/hash and recipe hash/config. Recipe hashes include the recipe and renderer/Sharp/libvips version. Old accepted print SHA references are untouched. Revision objects are retained while their photo exists; automatic revision-retention/pruning is not introduced by this feature.

A generation request is project/photo/version scoped. Its persisted generation counter fences canceled/superseded work. Publication checks the exact input, active request generation, current processing mode and override consent in the same database transaction as the current-slot update. A later custom upload cancels that consent, including when the bytes happen to match an older generated output. Jobs and outputs are idempotent. ZIP tokens snapshot file IDs and hashes and reject changed selections at retrieval; they do not grant access to historical private revisions.

New versions flow through existing authenticated upload and resumable endpoints using the stable version key. This is an internal integration seam, **not yet a public token-authenticated API**. Future Lightroom/CRM connectors should use this boundary and the shared schemas, not edit ORM rows. A Lightroom Classic connector, scoped integration tokens, general domain-event API, CRM adapters and a plugin marketplace are not included in this release.

The embedded SQLite job runner remains single-process. Browsing and delivery jobs share a two-image budget; old jobs gain bounded scheduling priority to prevent permanent backfill starvation. A separate multi-process worker must first introduce ownership/heartbeat leases and coordinated resource/storage semantics. Do not launch extra app processes against one database to scale rendering.

## Migration and development

Migration `0015_delivery_versions` is transactional and seeds upload-only versions from existing projects. It preserves file IDs, hashes, paths, policy maps and memberships; no automatic backfill runs during migration. It adds immutable revision records, processing state and custom-version download counts. Older binaries refuse unknown migrations: recovery uses a compatible release or a verified pre-upgrade snapshot, not an unsupported downgrade over the migrated database.

Run `npm test`, `npm run check`, `npm run build`, and `node scripts/verify-delivery-versions.mjs`. The feature tests use disposable SQLite and synthetic JPEGs. They cover migration preservation, uploaded byte equality, orientation/dimensions/color/metadata, explicit backfill, source/upload races, retry/pause, private masters, named downloads and stale ZIP/individual access. Browser verification exercises the settings/import flow, live queue, downloads and narrow-screen layout in an isolated instance.

Useful contribution areas: accessible settings/import controls, additional tested input formats, photographer-reviewed recipe presets, import manifests, connector contract fixtures and scoped upload tokens. Reusable studio presets and richer source/output comparisons can be added without changing photo identity or the current-file compatibility boundary.
