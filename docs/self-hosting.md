# Self-hosting

## Requirements and boundaries

Use a Linux amd64 Docker host with current Compose, persistent local storage and outbound package/image access.
The container runs as UID/GID 1000, includes Perl/ExifTool and fonts, and owns its newly created named volume.
Start evaluation with 2 vCPU / 2–4 GB RAM; this is a planning estimate, not a load-tested capacity promise.
Photo processing, RAW files and ZIPs need temporary disk beyond the originals. Monitor free space.

One app process serves one studio. SQLite lives on local storage, not NFS or a volume shared by replicas.
Docker Compose is the reference deployment; Kubernetes, ARM64 and Windows-container support are not verified.

## First-owner setup

Follow the README. The default Compose port mapping is `127.0.0.1:3000:3000`.
On a remote server, keep the TLS profile and other public routes off, then run this **on your own computer**:

```sh
ssh -N -L 3000:127.0.0.1:3000 your-user@your-server
```

Keep the terminal open and visit http://localhost:3000/setup. During setup, keep
`PUBLIC_ORIGIN=http://localhost:3000`; port forwarding then preserves the form origin.
Start with `SETUP_ENABLED=1 docker compose up -d app`, create the owner, and recreate with
`docker compose up -d --force-recreate app` to use the saved `SETUP_ENABLED=0` default.
Confirm `/setup` now returns 404 and the owner can sign in. Do not reopen setup to recover an existing login.

## HTTPS

Point your hostname’s DNS to the host. After private setup, edit `.env`:

```dotenv
DOMAIN=photos.example.com
PUBLIC_ORIGIN=https://photos.example.com
ORIGIN=https://photos.example.com
SETUP_ENABLED=0
```

Keep the existing signing secret. Permit inbound TCP 80/443, then:

```sh
docker compose --profile tls up -d
```

Caddy handles certificates and forwards to `app:3000`; the app’s direct port stays loopback-only.
Check the public login, gallery password gate and an actual large upload/download.
If using your own reverse proxy, forward to the loopback app port, retain the public `Host`,
allow streaming large uploads with suitable timeouts, and set `PUBLIC_ORIGIN`/`ORIGIN` explicitly.
Do not blindly trust incoming forwarded-client-IP headers; proxy address handling needs a trusted-hop policy.
Changing the bind address to `0.0.0.0` exposes plain HTTP directly and is not needed for Caddy.

## Configuration

`.env` is used by Compose and by Vite development. Direct production Node does not load it implicitly:
use `node --env-file=.env server.js` after building and set `NODE_ENV=production`.

| Setting | Meaning |
| --- | --- |
| `APP_SECRET` | Random 32-byte secret; keep stable and backed up privately |
| `PUBLIC_ORIGIN`, `ORIGIN` | Exact external scheme/host/port, no trailing slash; both must agree |
| `SETUP_ENABLED` | Only literal `1` enables first-owner setup; otherwise closed |
| `DATA_DIR` | Direct-Node data path; Compose always uses `/data` in its named volume |
| `BIND_ADDRESS`, `PORT` | Compose host listener; default loopback:3000 |
| `GATHERFRAME_IMAGE` | Local build tag or exact published image digest; never use floating latest for upgrades |
| `MAX_UPLOAD_BYTES` | Per-file limit, default 4 GiB |
| `ZIP_CACHE_MAX_BYTES` | ZIP cache budget, default 20 GiB |
| `STORAGE_MIN_FREE_BYTES` | Temporary-work free-space floor, default 256 MiB |
| `B2_*` | Optional private object storage; see B2 guide |
| `GOTIFY_ALLOW_PRIVATE` | Default 0; only enable deliberately for a trusted private notification host |
| `TZ` | Runtime time zone; visibility date filters are still UTC |

Mail/payment/notification details are configured in the application. No outgoing mail provider or payment
processor is preconfigured. Secrets and sensitive settings can exist in the database as well as `.env`.
For password recovery on an existing instance:

```sh
docker compose exec app node scripts/reset-admin.cjs --inspect
docker compose exec app node scripts/reset-admin.cjs --email owner@example.com
```

The second command requires an interactive terminal and prompts without echo. It revokes the selected
owner’s sessions, not gallery data. Never pass the new password through command arguments or issue reports.

## Common problems

- **Pending owner page:** setup is closed. Enable only through the private procedure above.
- **Cross-origin form refusal:** browser URL and configured public origin differ.
- **Cannot write `/data`:** a custom bind mount must be writable by UID 1000; the default named volume handles fresh ownership.
- **Photo processing fails:** inspect container logs, available disk and `/healthz` (which also checks ExifTool).
- **Blank stats:** activity begins with this installation; favorites from old devices are not imported.
- **New instance appears empty after an upgrade:** check the Compose project name and volume identity before making any new data.

See [operations](operations.md) before changing releases, volumes or storage providers.
