# One application, independent deployments

Gatherframe's public repository is the canonical application for both self-hosted
and managed studios. Commercial operation does not use a separate application fork.

## Repository boundaries

- **Public application:** application code, ordered migrations, tests, generic
  Compose configuration, build/install scripts, portable recovery tools and docs.
- **Private operations:** infrastructure, instance inventories, domain/resource
  configuration, secret references, reviewed image pins and deployment receipts.
  No copied application source; consume published application images.
- **Independent service tooling, if needed:** fleet provisioning, subscription
  billing and operator interfaces. A separate repository or API is not by itself
  an exemption from the application's license obligations.

Never put production credentials, databases, photographs, customer records or
backups in either repository. Corresponding source must match the running covered
version, including required build/install material; operational secrets are not
source code. See [the license](../LICENSE) and [operations](operations.md).

## Development and supported releases

Use short-lived branches and reviewed pull requests into `main`. Passing CI is
required. The initial solo-maintainer workflow permits the maintainer to merge
their own passing PR; a second reviewer is required when a second maintainer takes
responsibility. Never force-push or delete `main`.

Tags `vX.Y.Z` identify immutable source releases. Images are selected by registry
digest, not `latest` or a moving branch. Publishing a release does not deploy it.
The same image is promoted through isolated verification, a canary, an opted-in
pilot and scheduled customer batches. Each instance may have its own upgrade time.

During the 0.x phase, the current release is the maintained line. The immediately
previous release may remain deployed for a transition of up to 30 days after a
successor; this is an upgrade window, not a promise of feature/security backports.
Security fixes may require an earlier upgrade. No paid support SLA is implied.
Longer maintenance requires an explicit named release line, owner and end date.

Only create a `release/X.Y` branch when actually maintaining that older line.
Backport the minimum fix, retain a reference to its canonical commit, test that
line and publish a new patch tag. Bring emergency fixes back to `main` before
closing the issue. Never rewrite an already applied migration.

## Customer differences

Prefer settings for branding, terminology and workflow choices; deployment
configuration for domains, storage and resources; and versioned adapters for
integrations. Do not add customer-name conditionals or permanent customer branches.

A temporary patch exception must record its base release, owner, reason, issue,
test evidence, source offer and expiry date. On every upgrade, remove it or
explicitly revalidate it. Bespoke long-term software requires a separately scoped
maintenance commitment. Covered modifications remain subject to AGPL obligations.

## Release and recovery record

Every deployment records desired and observed image digests, source revision,
schema version, configuration revision, storage identity, secret references,
previous release, recovery-point reference and acceptance result. Keep sensitive
recovery receipts in protected operational storage, not public CI artifacts.

For the singleton SQLite architecture, stop the existing writer before starting
the candidate. Preserve volumes and signing secrets. Reverting a Git change or
image is not a database rollback; follow the compatibility and recovery procedure
in [operations](operations.md). A failed canary stops promotion.
