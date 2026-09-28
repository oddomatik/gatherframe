# Contributing

Small, focused pull requests are welcome. Discuss substantial behavior, data-model or API changes in an issue first.
Use fictional studios and generated images in examples; never attach a customer gallery, database or `.env`.

## Local workflow

Follow the README development setup. Use a feature branch, run the checks below, and explain
the problem, approach, verification and any upgrade implications in the pull request.
Use two-space indentation, UTF-8 and LF. Match nearby Svelte/TypeScript conventions; avoid unrelated formatting churn.

```sh
npm ci
npm run check:repo
npm run check
npm test
npm run test:tools
npm run build
npm run test:smoke
npx playwright install --with-deps chromium
npm run test:e2e
```

CI runs these against synthetic fixtures, then builds and boots the container.
For changes to specific photo workflows, run the relevant `scripts/verify-*.mjs` rehearsal after building.
They create their own disposable local servers. Do not redirect them at production.

## Map of the code

| Location | Responsibility |
| --- | --- |
| `src/routes/admin` | Photographer workspace and authenticated APIs |
| `src/routes/g`, `src/routes/media` | Guest galleries and access-checked media |
| `src/lib/server` | Import, storage, auth, pricing, orders, rendering and activity services |
| `src/lib/server/db` | SQLite schema and ordered SQL migrations |
| `src/lib/components` | Shared interface components |
| `scripts` | Isolated rehearsals and operator utilities |
| `docs` | User, deployment and contributor documentation |

SvelteKit + Svelte 5 + TypeScript, adapter-node, SQLite/Drizzle, Sharp and ExifTool.
The embedded worker and SQLite connection assume a **single application process** per instance.
Source bundles are made from an explicit allowlist before building, never from a data directory or Git history.

## Invariants reviewers should check

- Authorize before serving media, even cached/conditional responses. Preserve same-origin write checks.
- Private collection labels, XMP and RAW access remain private unless explicitly enabled for guests.
- One photo can belong to many collections. Reimports preserve IDs, assignments and accepted master hashes.
- Never silently replace print-quality files with social previews, or equate delivery with payment.
- Keep uploads, sorting drafts, replay protection and recovery safe through retries and version changes.
- Activity measures actions, not people or device-save confirmations; keep its privacy boundaries intact.
- Append migrations; do not edit or reorder an applied migration. Document backup and compatibility expectations.
- Every operational script must fail safely, avoid printing credentials, and target explicit data.

## Contributions and governance

Maintainers review changes; submitting a PR does not promise acceptance or release timing.
Require passing CI and review before merging into `main` once repository rules are configured.
For the initial solo-maintainer phase, owner-only maintenance merges may be necessary; document exceptions.
No contributor license agreement or copyright assignment is required. Contributors retain copyright
and contribute under AGPL-3.0-only. Do not introduce code you cannot license compatibly.
Any future alternative commercial license would require sufficient rights from all relevant contributors;
paid hosting does not require relicensing the community code.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
