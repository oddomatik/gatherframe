# Read-only demo studio

The demo is an opt-in, separately seeded instance of the same AGPL application. It is not a paid-only edition. Ordinary installs retain their authenticated studio and gallery behavior.

Use an independent hostname, data volume, and signing secret. **Never enable demo mode on customer data or copy a customer database into a demo.** Its studio is intentionally public.

## Prepare sample content

After `npm ci && npm run build`, provide six original or licensed PNG photographs in a private asset directory: `coast-wide.png`, `coast-detail.png`, `forest-wide.png`, `forest-detail.png`, `meadow-wide.png`, and `meadow-detail.png`. Landscape/portrait pairs work best. The sample copy assumes AI-generated nature photography; adjust disclosure if using other assets. Photo binaries are not distributed in this source repository.

Run `node scripts/seed-demo.mjs /new/empty/demo-data /path/to/photos`. The seeder refuses an existing database. It bootstraps a fictional owner with an unknowable random password, then creates one project, three collections, six photos, three illustrative orders and synthetic activity. No customer contacts or payment destinations are included.

Run the built app with `DATA_DIR` pointing to that directory, a **new** `APP_SECRET`, `SETUP_ENABLED=0`, `DEMO_MODE=1`, and the demo's own `ORIGIN` and `PUBLIC_ORIGIN`. Do not configure external storage or notifications. Keep one app process per SQLite volume, as for normal installs.

Demo startup requires the explicit fixture marker and fictional owner and refuses external notification configuration, storage credentials, or enabled setup. This prevents accidental activation on an ordinary studio; it is not a scrubber for copied private data.

## What visitors can do

- Browse the landing page, album, collections, tags and full-screen swipe viewer.
- Keep favorites and a sample print layout in their own browser.
- Download the sample photographs and explore a read-only studio.
- Preview an illustrative checkout without supplying contact details or placing orders.

All write methods are blocked before routing except read-only quote calculation and transient ZIP preparation. Activity ingestion is discarded, so seeded metrics remain illustrative. Downloads may create short-lived tokens/logs; read-only means shared content cannot be edited, not that the database never writes. Upload inputs are disabled; other save actions explain that the demo is read-only. Setup is unavailable. Every page is marked noindex.

To replace the showcase, seed a **new** empty directory and deliberately switch only the demo volume. Keep public routing off during initial provisioning and verify the exact image before enabling it. The source download must match that image, including modifications.

## Verification

`npm run build && node scripts/verify-demo.mjs` checks fixture refusal, server-side write denial, public studio access, mobile rendering and swipe, browser-only favorites, checkout privacy, unchanged sample content and ordinary-mode authentication. The test generates disposable image fixtures and never accesses a live host.
