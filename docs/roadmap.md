# Roadmap

Priorities, not delivery dates or already-shipped promises.

## Public self-hosting foundation

- Clean source, documented Docker setup, AGPL license, contribution workflow and reproducible checks.
- Verify fresh owner setup, restart, snapshot/restore and upgrade refusal on unknown schemas.
- Publish the first reviewed versioned image/source release after repository configuration and owner review.

## Managed-hosting pilot

- Automated isolated provisioning, limits, private secrets and a fleet release inventory.
- Explicit maintenance/draining and canary upgrades; define downtime and rollback contracts.
- Complete media + database recovery, independent backups, monitored restore drills and alerts.
- Usage accounting, customer exports, access audit and deletion/deprovisioning procedures.
- Subscription lifecycle and support process; first pilots should be small and directly supported.

## Product improvements guided by users

- More representative physical-phone and camera RAW acceptance coverage.
- Streamlined import and B2 migration with verified object/file identity.
- Accessibility and internationalization review.
- Optional payment-provider and print-lab integrations, designed separately from basic gallery access.

No commitment to a shared-database multi-tenant rewrite. Preserve one common codebase and reversible,
verified upgrades before expanding the hosting fleet.
