# Third-party notices

Gatherframe’s original code is licensed under AGPL-3.0-only. Installed dependencies and their transitive
dependencies retain their own copyright notices and license terms. The lockfile records exact npm versions.
Distribution of the Docker image also includes Debian/Node packages and fonts with their own notices.

Major components include Svelte/SvelteKit, Vite, Drizzle ORM, better-sqlite3, Sharp/libvips,
ExifTool, the AWS SDK, tus, PhotoSwipe, Nodemailer, Argon2 and Tailwind CSS.
See each installed package’s `LICENSE`, `COPYING` and `NOTICE` files; do not strip them from distributions.
ExifTool and native/image libraries may have different terms from their JavaScript wrappers.

Only the project favicon and code-generated synthetic fixtures are included as visual assets.
No customer photographs, proprietary Lightroom binaries, or branding rights are granted by this repository.

Before publishing a binary release, review the production dependency inventory and container scan
alongside notices for the exact image. Package metadata alone is not a complete license audit.
