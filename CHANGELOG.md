# Changelog

## Unreleased

- Read-only self-hosting doctor with actionable private owner setup, storage,
  database, local HTTP and recovery guidance; structured output omits secrets
  and identities and never changes installation state.

- First-delivery guide with saved-state checks for imports, guest-ready photos,
  publication/closing time and usable scoped access. Links to existing controls;
  no automatic publication, messages or claimed recipient verification.

## 0.2.0 — 2026-10-02

- Adaptable simple, story/chapters and directory gallery layouts, public collection
  titles/descriptions, independent photo/chapter ordering and optional sales.
- Collection-scoped invitations with expiry, rotation/revocation, download controls
  and an explicit scoped-only mode that disables broad project links.
- Persistent proof-selection drafts, submission, photographer feedback, acceptance,
  reopening and immutable revision history; no automatic recipient notifications.
- Optional interactive print-package planner.

Upgrade notes: migrations through `0017_scoped_sharing_and_proofs` preserve existing
project defaults and photo/file identities. Existing broad links remain enabled
unless scoped-only access is explicitly selected; new-project defaults favor a
simple gallery with sales off. Automatic delivery generation remains opt-in.
Pre-upgrade database, media and configuration recovery points are required.
Code-only rollback to 0.1.0 is unsupported after migration: use a verified isolated
pre-upgrade recovery point and reconcile any subsequent writes.


- Named delivery versions with unchanged photographer-authored exports, folder
  mappings, explicit download filenames and optional generated Web JPEGs.
- Configurable dimensions, quality, light sharpening and metadata handling;
  sample previews, reviewed backfills, targeted retry and batch pause.
- Immutable file revisions and source/recipe tracking; uploaded overrides and
  newer source revisions fence in-flight work. Stale individual/ZIP downloads
  are rejected, and existing projects migrate without automatic generation.
- Shared image-processing limits and immediate queue refill between jobs;
  custom-version download counts and integration-oriented service contracts.

## 0.1.0 — 2026-09-29

First public release. This is an early self-hosted application release, not a
managed-hosting launch or a paid service-level commitment.

- One canonical application/release stream for self-hosted and managed instances;
  documented private operations boundary, support window and temporary patch policy.
- Neutral guest/customer/collection language with configurable per-project order
  reference labels; existing explicit labels and saved selections are preserved.
- Separate opt-in read-only demo mode with synthetic fixtures and blocked writes.
- Mobile-first galleries: compact headings and controls, readable touch targets, and collapsible tag filters.
- Edge-to-edge photo viewer on phones/touch devices with swipe navigation, pinch/double-tap zoom, tap-to-hide controls, favorites, sharing and full-quality download access.
- Optional full-screen desktop viewing while preserving the existing comparison/filmstrip workspace.
- Browser coverage for touch gestures, rotation, filtered favorites, rapid dismissal, loading failures and preserved gallery state.

- Preserves gallery, import, saved collections/favorites, download, ordering, fulfillment and visibility features.
- Portable Compose setup with named persistent data volume and explicit private owner setup.
- Startup configuration validation, closed-by-default setup and unknown-migration downgrade refusal.
- Consistent SQLite snapshot utility and isolated restart/restore smoke tests.
- GitHub CI, manual release workflow, contribution/security guidance and dependency updates.
- AGPL-3.0-only licensing and per-build corresponding-source download.

No private operational history or customer assets are included. Existing legacy
schema, storage identifiers, session keys and owner-authored content are retained.
