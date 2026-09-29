# Publishing this repository

This document distinguishes prepared files from GitHub-side configuration and an actual release.

## Before the first public push

- Publish only this clean source repository. Do not add private operational Git history, deployment inventory,
  screenshots of real families, credentials, databases, backups or account metadata.
- Confirm the AGPL license choice and ownership of contributed material. Review third-party distribution notices.
- Run the repository hygiene and full-history secret scan, CI-equivalent checks and fresh Compose rehearsal.
- Set the repository description, real maintainer contacts and an accurate public roadmap.

## GitHub settings (must be configured after repository creation)

- Enable private vulnerability reporting; add a private conduct/security contact.
- Enable issues with the supplied templates; use Discussions for support if someone will monitor them.
- Protect `main`: pull requests, successful `CI / verify`, resolved conversations, no force pushes/deletions.
  Require a reviewer when another maintainer is available; document solo-maintainer exceptions.
- Add `CODEOWNERS` with real maintainer/team handles, not placeholder identities.
- Enable dependency alerts and review Dependabot PRs. Do not automatically merge runtime/migration upgrades.
- Create a protected `release` environment with required reviewers for the publication workflow.
- Grant only the required Actions/package permissions; fork PRs do not receive deployment secrets.
- Confirm GHCR package visibility and exact image digest after the first deliberate release.

The CI and release workflows are committed configuration, not evidence that GitHub has run them.
The release workflow publishes an image when a reviewed semver GitHub release is explicitly published;
it never upgrades a running instance. No cloud resources or subscription billing are provisioned by this repo.

If the release event does not start publication, manually dispatch the release
workflow with the existing published `tag`. Both CI and image publication check out
that exact tag; the image revision label comes from the checked-out commit, not the
dispatching branch. The tag must match package metadata and be reachable from main.

## Dependency review

The September 28, 2026 preparation audit reported zero high/critical advisories and nine lower-severity
findings (six moderate, three low), including development tooling and a transitive cookie package.
The current gate fails on high/critical findings; it does not declare all dependencies vulnerability-free.
Review the exact audit report for each release. Do not apply `npm audit fix --force` blindly; the suggested
changes include major upgrades or downgrades. Native/container packages require separate review too.

Legacy compatibility identifiers such as `picture-day-drafts`, import state keys, B2’s default prefix and
the Compose data-volume key are intentionally retained. The display/package name is Gatherframe; renaming
persisted identifiers needs an explicit migration, not a global search-and-replace.
