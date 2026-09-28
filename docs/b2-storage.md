# Optional Backblaze B2 photo storage

Gatherframe can keep new photo files on local disk, in a private B2 bucket, or in both places. The default remains **local**. Lightroom filenames, version matching, collections, share links, and ordering remain application concepts; they do not depend on where the bytes live.

## Owner workflow

1. Have a private B2 bucket and a bucket-restricted application key configured in the server environment as described below.
2. Restart the app so it reads the environment.
3. Sign in and open **Storage** in the photographer navigation.
4. Choose **Test connection**. The app checks that the bucket is private, uploads a tiny random probe, checks its metadata, reads and verifies it, and deletes that probe. It does not alter your photographs.
5. Choose **In Backblaze B2** or **B2 + a local copy**, then **Save storage choice**.
6. Use **Bring in photos** exactly as before. Rehearse with a small batch before importing a whole shoot.

The test is bound to the configured destination and credentials. Switching to a remote mode requires a successful test from the last 24 hours. This time limit applies to selecting the mode; it does not require a daily test to keep using it. Local storage is always selectable.

| Choice | New files | Local disk use |
| --- | --- | --- |
| On this server | Local only | Original versions and generated previews remain local |
| In Backblaze B2 | Private B2 objects | Temporary incoming files and processing space are still required |
| B2 + a local copy | Private B2 objects and local copies | Full local copies are retained too |

The mode applies to **new writes**. Selecting B2 does not transfer existing photos. Selecting local does not download older B2 photos. Reading an existing file uses its recorded location, not the current upload setting. Counts on the page refer to tracked files, not the number of children or photographs; each image version/preview can have its own record. Existing local files that predate the storage registry remain readable but may not yet appear in these counts.

## Private server configuration

Use the B2 console to make a **private** bucket, then a **standard application key restricted to that bucket**. The master account key is not supported by B2's S3 API. The key must be able to read the bucket ACL and read, write, and delete its files (`readBuckets`, `readFiles`, `writeFiles`, `deleteFiles`). The connection test removes only its own random probe. An application key can additionally be restricted to the prefix used below. See [Backblaze application keys](https://www.backblaze.com/docs/cloud-storage-application-keys) and [S3 application-key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys).

Put the following values in the app's private runtime environment, using the bucket's actual endpoint and region. The example is a template, not working credentials:

```dotenv
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_BUCKET=your-private-picture-day-bucket
B2_KEY_ID=YOUR_BUCKET_RESTRICTED_KEY_ID
B2_APPLICATION_KEY=YOUR_PRIVATE_APPLICATION_KEY
B2_PREFIX=picture-day
```

The S3 endpoint uses HTTPS and does not include the bucket name. Copy the endpoint and corresponding region from your bucket rather than assuming the example region. [Backblaze endpoint documentation](https://www.backblaze.com/docs/en/cloud-storage-call-the-s3-compatible-api)

Keep the real values in a private environment file or your service's secret manager, not in `.env.example`, Git, browser forms, chat, logs, or screenshots. Protect a runtime environment file with owner-only permissions. Use the existing service's normal environment loading mechanism; changing the file alone does not update an already running Node process.

`B2_PREFIX` is an object-key namespace, not a local directory. Keep it stable after setup. A prefix-restricted key must cover that prefix and its descendants, including the connection probe. If you rotate credentials or change the endpoint, bucket, region, or prefix, new remote writes pause until you **test the connection and save the B2 choice again**. Previously approved settings do not expire for ongoing uploads. Keep access to original destinations for existing remote files; changing the new-upload destination is not a migration.

This implementation uses server-to-B2 requests. Browser CORS configuration and public bucket access are not needed. Do not make the bucket public to make images load: the app enforces event/photo access and serves private files through its authorized routes.

### Working-space controls

The server still holds SQLite, incoming upload staging, processing workspace, and ZIP-related temporary data. B2 is not a zero-disk mode. The backend bounds concurrent downloads for processing; these optional environment controls adjust its limits:

```dotenv
# Reserve at least this much free disk before new temporary work (default: 256 MiB).
STORAGE_MIN_FREE_BYTES=268435456
# Concurrent remote files materialized for processing; 1–8, default 2.
STORAGE_MATERIALIZE_CONCURRENCY=2
```

Keep enough free space for the largest file and simultaneous work beyond that reserve. A reserve is a check, not a disk quota. Large imports still travel through the app server; direct browser-to-B2 multipart transfers are not implemented. Browser uploads now resume through the app server; after a browser restart, reselect the source files to continue from verified received bytes.

## Existing photos, recovery, and backups

The app currently creates consistent daily SQLite snapshots on its own data volume and retains the newest 14. These are **local recovery copies**, not off-server backups. App-managed database snapshots to B2, a restore workflow, and a verified existing-file migration tool are still development work. B2 configuration alone does not make the database or in-flight upload storage disposable.

- No automatic migration, local pruning, or deletion-by-folder-absence is enabled by changing the mode.
- Changing storage mode does not change a photo's ID, shared collection memberships, filenames used for import matching, or share links.
- An unavailable B2 destination must cause a failed operation/retry, not a silent successful upload or fallback to local storage in B2-only mode.
- Preserve the app database and the original-destination access needed by its remote records. B2 alone is not a backup of the database, orders, or collection membership.
- Keep your Lightroom catalog and camera originals independently. A B2-plus-local copy provides two locations, not a substitute for a recoverable backup policy.
- Avoid lifecycle policies that delete objects still referenced by the app. Old versions can matter for print orders and recovery; storage cleanup should be deliberate.

## Connection test troubleshooting

The page reports a safe, generic failure rather than provider errors that might contain signed URLs or credentials. Check, privately on the server:

- The endpoint and region match the bucket; the endpoint is HTTPS and contains no bucket path.
- All credential fields are present, the key is unexpired, and the process has been restarted after changes.
- The bucket is private and the key can read its ACL (`readBuckets`). Private-bucket verification failing is a failed test, not permission to skip it.
- The key can upload, read, and delete the probe beneath the configured prefix.
- Bucket retention/Object Lock rules do not prevent deleting the temporary probe. Do not disable protection on unrelated data just for this app; use an appropriate app-specific bucket/configuration.
- The server can reach Backblaze over HTTPS.

Testing and saving are separate operations. A failed test never changes the selected storage mode. If B2 was already selected, address the failed connection before the next import; selecting local remains possible, but previously remote files still need B2 access.
