# Roadmap

The current priority is **a confident first shoot on a self-hosted installation**.
These are priorities and acceptance goals, not delivery dates. Source merged to
`main`, a tagged release, and an updated hosted demo are separate milestones.

## Foundation in place

- Public AGPL source, Docker setup, owner bootstrap, versioned releases and recovery tooling.
- Gallery layouts, shared collection membership, named delivery versions and optional print orders.
- Scoped invitations and saved/submitted proof selections with revision history.
- First-delivery guide and a read-only self-hosting doctor merged to `main`.

Use the [release history](https://github.com/oddomatik/gatherframe/releases) to
check what is in an installed version; the hosted demo may lag current source.

## Adoption next

| Priority | Outcome | Acceptance goal |
| --- | --- | --- |
| 1. Show the product | A visitor can understand the photographer and client workflows before installing. | Real, reproducible screenshots, a visual tour, working demo links and honest feature boundaries. |
| 2. Rehearse a first shoot | A new self-hoster can go from an empty install to a verified guest delivery without maintainer assistance. | Small synthetic import pack, one end-to-end walkthrough, useful recovery steps, and a clean-install rehearsal using only the published instructions. |
| 3. Close the release loop | New onboarding and documentation reach a versioned, recoverable release. | Exact-commit CI, snapshot/restore rehearsal, release notes, refreshed demo, and clearly reported physical-phone coverage or remaining gaps. |

## After the first-shoot path is proven

- Streamlined import and B2 migration with verified object/file identity.
- More representative physical-phone, camera RAW and accessibility coverage.
- Internationalization guided by actual users.
- Payment-provider and print-lab integrations scoped separately from basic gallery access.

## Managed hosting: later, not an available service

Before offering a supported pilot: isolated provisioning and limits, private
secrets, fleet release inventory, canary upgrades, independent backups and
restore drills, exports/deletion, usage accounting, and a support process.

No commitment to a global-library or shared-database multi-tenant rewrite.
Keep one common codebase and reversible, verified upgrades before expanding
scope or the hosting fleet.
