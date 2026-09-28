# Releases, upgrades and recovery

## Release contract

Use immutable image digests and keep the exact matching source/tag. One image runs unchanged across
self-hosted and managed instances; there are no per-customer code forks. The release workflow prepares
an amd64 GHCR image, SBOM/provenance and immutable digest on an explicitly published semver release.
No registry image exists merely because this workflow is present.

Before releasing: complete CI, review dependency/container findings, bump package and lockfile version,
update the changelog, document migration compatibility, and tag `vX.Y.Z` on reviewed `main`.
Enable the GitHub `release` environment with required reviewers to gate the publication job.
No workflow deploys customer instances or changes their secrets.

## Updating an instance

1. Read release notes and compatibility requirements; pull/build the candidate before maintenance.
2. Confirm no active uploads, sorting saves, downloads or production jobs. Arrange a maintenance window;
   do not assume health means idle. Block new ingress and let in-flight work finish.
3. Record the old image digest, Compose project/volume names and configuration. Make a consistent backup
   and verify it; include all local media and remote-object recovery coverage, not only SQLite.
4. Stop the old app. Never overlap two app containers against the same database.
5. Change only the image/source release, preserving the named volume and `APP_SECRET`.
6. Start one candidate. Migrations apply transactionally, one ordered migration at a time.
7. Verify health, login, setup closed, gallery authorization, photos/downloads, counts and representative
   assignments/orders before reopening traffic. Keep the backup and old image until acceptance completes.

Source-build example (after pulling reviewed code and preparing the backup):

```sh
docker compose build app
docker compose stop app
docker compose up -d --no-build app
docker compose logs --tail=80 app
```

Published-image example: set `GATHERFRAME_IMAGE=ghcr.io/YOUR_OWNER/YOUR_REPO@sha256:REVIEWED_DIGEST`
in the existing private `.env`, then `docker compose pull app`, stop, and `docker compose up -d --no-build app`.
The uppercase placeholders must be replaced with a real release receipt. Do not run `pull` for the local-only build tag.
Keep using the same `docker compose -p INSTANCE_NAME` if you originally used `-p`.

## Database snapshot

```sh
docker compose exec app node scripts/snapshot-db.mjs /data/backups/pre-upgrade.sqlite
```

Use a new destination for every backup. The utility uses SQLite’s backup API, includes committed WAL
transactions, checks integrity/foreign keys, uses private file permissions, and refuses to replace a file.
It can take a consistent database copy while the app runs; for a **whole-instance** recovery point,
quiesce uploads/writes and coordinate it with the media snapshot. Backups contain private records.

A copy on `/data` is only a rollback aid. It does not survive volume/host loss. Copy the verified database,
configuration (including signing secret), local originals/derivatives and required remote objects to a protected
independent destination according to your own retention plan. No external backup schedule is enabled by the app.
Changing to B2 only changes new writes; it does not migrate old local files or back up SQLite.

## Restore rehearsal

Never test restoration over the live volume.

1. Create a separate private data directory/volume and copy the snapshot to `db/app.sqlite` while stopped.
   Use a fresh database directory without stale `app.sqlite-wal` or `app.sqlite-shm` files.
2. Restore matching media paths and per-object B2 access. Keep the original secret; isolate the recovery
   listener from public traffic and disable external notifications. Rehearse against cloned media/bucket access
   rather than allowing a recovery instance to modify live remote storage.
3. Boot the same release used for the backup. Verify SQLite integrity, media hashes, login, collections,
   orders, file downloads and production masters with synthetic or explicitly authorized checks.
4. Only after verification, switch routing with the old writer stopped. Keep the prior volume recoverable.

`npm run test:smoke` exercises empty setup, persistence and a separate-directory database restore with
synthetic data. It is not proof your offsite media backup is complete.

## Rollback is not just an old image

The app refuses databases containing unknown migration IDs. This prevents common accidental downgrades;
it does not establish compatibility for every data change. Each release must state whether code-only rollback
is safe. Otherwise restore a verified pre-upgrade snapshot and matching media into a new volume.
Any activity accepted after that snapshot needs reconciliation; do not discard newer customer work to force
old fingerprints to match. Prefer a forward fix when newer writes must be retained.

Automatic rolling updates/Watchtower are unsuitable for this singleton/migration model.
