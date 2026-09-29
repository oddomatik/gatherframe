# Changelog

## Unreleased

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
