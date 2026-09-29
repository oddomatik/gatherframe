# Guest visibility

Admin → Visibility, or the Visibility link beside a project's Upload button.

## Metrics

- **Gallery views:** loaded album, collection and browse/tag pages. Client navigation events, not raw HTTP hits, SvelteKit preloads, filter rerenders or sharing previews.
- **Guest browsers:** distinct pseudonymous visitor cookies per project across all recorded actions in the selected period. Approximate, not unique people; cleared cookies/devices and different projects count separately.
- **Saved collections / favorites:** additions and removals in the selected window, not a current inventory. Existing device-local choices are never imported. Photo previews count large-view opens/next/previous.
- **Downloads sent:** full-response EOF observed on the server. Individual-file, phone share-preparation and ZIP channels; social/full-resolution/RAW file counts. HEAD, rejected requests and partial range responses cannot count as full transfers. Aborted or failed streams do not count as sent. Requests include partial/failed-to-finish streams, and retries may count again. A sent response does not prove a save to the device; phone preparation does not prove share-sheet use. ZIP bytes refer to source-file bytes, not wire/compression overhead.

Project and inclusive UTC date filters (7/30/90 day shortcuts); daily accessible chart and table; top 50 collections by opens, top 30 photos by favorite adds. Refresh explicitly retrieves current totals. Empty periods show an honest no-data state. Stats start at migration, never backfilled from unrelated old download logs.

## Boundaries

All first-party, within Gatherframe's existing database. No third-party analytics script, visitor names, IPs, emails, referral URLs, photos or free text in new activity records. A project-scoped HMAC replaces the existing visitor sid, so no raw sid or cross-project tracking ID is stored here. Private collection labels and filenames are resolved only on authenticated admin views. All signed-in admin browsing—including guest-preview mode—is excluded. Known crawler user agents are excluded. Blocked JS/telemetry, offline activity and unknown bots affect accuracy.

The client endpoint requires current project access, same origin, a small bounded JSON body, a fixed schema, validated project-owned public photo/collection references and per-visitor rate limiting. Event UUID retries deduplicate within visitor/project; observers cannot submit download-success claims. Server-only transfer instrumentation retains actual access and file-integrity checks. Download delivery never depends on the new analytics write succeeding. Existing legacy download logs no longer collect IPs on these routes.

Raw activity is retained for 90 days; an indexed hourly-at-most sweep runs on ingestion. Reports are constrained to the retained window. Deleting a project cascades its activity. This is not a permanent lifetime-total dashboard and does not add backup jobs. No B2, NAS, order, payment, printing, or guest email settings are changed.
