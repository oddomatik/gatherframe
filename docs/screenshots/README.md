# Screenshot and sample-asset notes

These screenshots show real Gatherframe pages, captured by Chromium against a
disposable loopback-only studio. No customer data, live-instance access, or
mocked application UI is used. **Fieldwork Studio**, recipient notes and orders
are fictional. Nature photographs are original AI-generated demo assets made
on 2026-09-28, not client work or a photographer's portfolio claim.

## Refresh the tour

From the repository root, using the supported Node version:

```sh
npm ci
npx playwright install chromium
npm run build
npm run docs:screenshots
npm run check:repo
```

The capture script accepts no live URL or data-directory argument. It converts
the six bundled optimized samples to temporary inputs, seeds a new database,
starts a loopback server, and exercises the actual gallery, layout, invitation,
proof submission and project-creation flows. Network requests outside that
server are blocked in the browser. Temporary data and processes are cleaned up.
No existing `.env` or provider credentials are passed to the fixture server.

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed browser; otherwise
the script checks Playwright's Chromium and common local Chromium locations.
Refresh from a committed, built application revision. Dates, browser versions
and font rendering can change pixels; the workflow is reproducible, not a
promise of bit-for-bit identical screenshots.

Review every image after regeneration. Confirm photographs loaded, no secrets
or one-time invitation URLs are visible, captions still match the UI, and the
images remain readable at documentation size. The mobile capture is Chromium
viewport emulation, not physical iOS/Android acceptance proof.

## Publication boundary

- [Screenshot manifest](manifest.json): source revision, descriptions, dimensions,
  byte sizes and SHA-256 fingerprints.
- [Photo fixture manifest](../../scripts/fixtures/showcase/manifest.json): sanitized
  provenance and fingerprints of the six optimized source photos.
- Only the fourteen explicitly named WebP assets are exempted from the repository's
  image-file ban, with validated fingerprints, a 1 MiB per-file limit and a 4 MiB
  aggregate budget. Unlisted images, databases, private keys and runtime data remain
  prohibited. The dedicated secret scan is unchanged.
- These synthetic sample assets are intentionally part of the repository's
  documentation and corresponding-source archive, under the repository's
  AGPL-3.0-only terms. This does **not** include or license anyone's uploaded photos,
  customer records, or private studio files.
