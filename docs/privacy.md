# Privacy and data handling

Gatherframe is software you operate. It has no central telemetry collector or hosted tracking dependency.
This is a description of the software, not a ready-made legal privacy notice for every deployment.

- Photos, original filenames, capture metadata and private XMP/ACR sidecars may be sensitive.
- Studio accounts, sessions, orders, customer contact details, requests and settings live in SQLite.
- Gallery links act as access capabilities; optional passwords add a separate gate. Protect invitation links.
- Favorites and “Saved collections” selections are device/browser-local. First-party activity separately records
  add/remove actions and project-scoped pseudonymous visitors, retained for 90 days.
- Visibility records exclude names, emails, IPs and referral URLs. Older databases may still have historic
  download-log fields; reverse proxies and application error logs can also contain URLs or addresses.
- Public link-preview images are deliberately public, including for password-gated albums. Choose a neutral
  title card if the image should not be disclosed to link-preview services.
- B2, email and notification providers receive data only when operators configure and use those integrations.
- The `/source.tgz` download contains application source, not the database, `.env`, uploads or Git history.

Operators choose retention, consent, access, exports and deletion procedures appropriate to their customers.
Document who can administer the instance, how backups expire and how a customer can request an export or deletion.
There is no blanket school/privacy/compliance certification, complete self-service erasure workflow or automatic
purge of independent backups. Do not promise those capabilities before implementing and verifying them.
