# Gatherframe

Self-hosted photo galleries for events, sessions, portfolios and studios.
Organize one photograph into several collections, share private albums,
deliver finished files, and take print orders without giving up your editing workflow.

**Early release:** a working single-studio application, not a multi-tenant SaaS platform.
Run one application process per database. Managed hosting is a planned service, not yet available.

## What it does

- Photo-first galleries, collection covers, project-defined tags and shareable branches.
- [Adaptable gallery presentation](docs/gallery-presentation.md): direct photo grids, named story sections or collection directories, with optional public titles and independent collection sequences.
- Lightroom-friendly full-resolution, social and RAW imports; private XMP/ACR companions.
- [Named delivery versions](docs/delivery-versions.md): preserve your exports or generate optional smaller JPEGs, with custom upload overrides.
- Resumable uploads, recoverable sorting, independent photo identity and shared collection membership.
- Browser-local favorites and saved collections, individual/ZIP downloads and phone sharing preparation.
- Configurable print products, order receipts, manual payment records and production/master approval.
- First-party visibility dashboard for views, favorites, collection saves and download types.
- Local media storage or optional private Backblaze B2; no external analytics service required.

There is no automatic card processing, print-lab fulfillment, face recognition, multi-tenant account isolation,
automatic media migration, or complete hosted backup service. See the [roadmap](docs/roadmap.md).

## Quick start: Docker Compose

Requires Docker Engine with Compose, Node.js 22 or 24 **only for the optional configuration generator**,
and enough disk for your photos, previews and temporary ZIPs. Linux amd64 is the verified container target.
Clone or download this repository, then run from its root:

```sh
node scripts/init-env.mjs
docker compose build app
SETUP_ENABLED=1 docker compose up -d app
```

Open **http://localhost:3000/setup** on the Docker host and create the first owner.
The default listener is loopback only. On a remote host, use an SSH tunnel as described in
[self-hosting](docs/self-hosting.md); keep public routing disabled during setup.

After creating the owner:

```sh
docker compose up -d --force-recreate app
```

This returns setup to disabled (`SETUP_ENABLED=0` in `.env`). Sign in at **http://localhost:3000/admin**.
The named data volume and signing secret survive recreation. **Do not use `docker compose down -v`**
unless intentionally deleting the instance and its data.

No Node on your server? Copy `.env.example` to `.env`, set `APP_SECRET` to `openssl rand -hex 32`
output, and protect the file with `chmod 600 .env`. Never use an example secret.

Project language is neutral by default; [customize the optional order-reference label](docs/terminology.md) for each project.

## Demo studio

An optional [read-only demo mode](docs/demo.md) provides a sample gallery and public studio tour in a separately seeded instance. No private photos, contact details or real orders are needed.

## Self-hosting and operations

- [Configuration, HTTPS and owner setup](docs/self-hosting.md)
- [Upgrades, snapshots and recovery](docs/operations.md)
- [Optional B2 storage](docs/b2-storage.md)
- [Managed-instance architecture](docs/managed-hosting.md)
- [Privacy and data handling](docs/privacy.md)
- [User workflows and feature guides](docs/user-guide.md)

## Development

Use Node.js 22 LTS (see `.nvmrc`) or 24, npm, Perl and tar. The Docker image includes its runtime dependencies.

```sh
npm ci
npm run env:init -- --development
npm run dev
```

Visit http://localhost:5173/setup. Development binds loopback; use synthetic photos, not customer data.
The generator never replaces an existing `.env`. If switching from Docker instructions,
set `PUBLIC_ORIGIN` and `ORIGIN` to `http://localhost:5173` and `SETUP_ENABLED=1` deliberately.

```sh
npm run check:repo
npm run check
npm test
npm run test:tools
npm run build
npm run test:smoke
npx playwright install chromium
npm run test:e2e
```

Browser and smoke scripts create disposable data and loopback servers themselves.
Phone tests use Chromium viewport emulation; they do not certify physical iOS sharing.
See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, testing and review expectations.

## License and source

[AGPL-3.0-only](LICENSE), Copyright 2026 Gatherframe contributors. Commercial hosting is permitted;
modified network versions must meet the license’s source-availability requirements.
Every standard build exposes its corresponding source and license at `/about`.
Photos and customer records are **not** licensed under AGPL or included in that source download.
Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

For security reports, follow [SECURITY.md](SECURITY.md), not a public issue containing private records.
