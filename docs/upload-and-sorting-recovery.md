# Upload and sorting recovery

## Uploads

The upload screen hashes each file off the UI thread, asks the signed-in project for a transfer session, then sends 8 MiB tus chunks. It schedules full-resolution JPEG roles first, social next, then private sidecars and RAW. The progress bar measures received bytes; the file count advances only after the existing importer has verified and committed the file.

- Pause/retry resumes received bytes. After reload or browser restart, reselect the same export folder. The browser does **not** retain file access or source bytes.
- SHA-256, filename, role, project, owner, destination and batch choices identify a pending transfer. Identical saved versions are checked before transfer.
- Partial transfers expire after seven days. A 32 GiB aggregate pending-transfer allowance and free-disk checks bound scratch usage. The regular sweep cleans expired/orphan transport files.
- A replacement still requires **Update existing versions in this batch**. Finalization verifies the entire file hash and rechecks the photo/version baseline. Another upload changing that role causes a review conflict.
- Completion receipts make lost-response retries safe. The old whole-file endpoint remains for tabs opened before this release.
- Local and B2 final storage use the existing immutable ingest path. This is server-resumable transport, **not** direct-to-B2 multipart transfer. It cannot exceed the internet connection's bandwidth.

## Sorting

Collection-assignment drafts are saved in IndexedDB, partitioned by authenticated account and project. **Saved on this device** appears only after the transaction for the current draft has completed.

- Open **Resume sorting draft** after returning to the project. Recovery never submits assignments automatically.
- Closing the sorting window keeps the draft. **Discard draft** deliberately removes it.
- A saved baseline detects intervening collection changes. **Review latest state** refreshes the current collection context while retaining proposed assignments; a separate save is still required.
- An interrupted save retains its exact request identifier and intent. Retry **Save & finish** to confirm the same operation.
- **Undo last sorting save** restores the earlier memberships only if the collection state has not changed since. It leaves newly created collection names, photo files, tags and orders intact. It is not yet general undo for tags, deletions or all admin edits.
- Concurrent tabs cannot overwrite each other's local draft, including discarded drafts. On storage failure, edits stay in memory with an explicit warning and retry control.
- Supported: edit an already-open batch through connection loss and recover it after an online reload. Cold offline app startup, cross-device draft sync, and recovery after browser storage is cleared are not provided.
