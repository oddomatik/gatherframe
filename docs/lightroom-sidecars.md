# Lightroom sidecars

Choose your RAW folder under **Bring in photos → RAW**. Include the matching
`.xmp` and, when Lightroom provides one, `.acr` files. Common-parent folder
selection and dropped files also work. Keep the same basename:

```text
full/IMG_0042.jpg
social/IMG_0042.jpg
raw/IMG_0042.CR3
raw/IMG_0042.xmp
raw/IMG_0042.acr
```

The importer matches across the whole event, independent of collections and
folder names. Files may arrive in any order or in separate batches. A sidecar
without its image is retained while awaiting that image. Missing files in a
later batch never delete an earlier upload. Identical uploads are unchanged;
different bytes require **Update existing versions**.

## Useful, private organization

Readable XMP keywords, rating, color label, title and description are available
only to the photographer. Search keywords in the event organizer, filter by
rating, then use the normal selection and **Add to collection** controls. A
shared photo can still belong to several children's collections. These tags do
not automatically create collections, publish images, reject photos, rename
photos, or change covers. Importing a later sidecar updates the private metadata
only after accepting replacement.

Sidecars are stored separately from downloadable image variants. They use the
same local/B2/B2-with-local-copy setting as other new uploads. Parent pages,
photo links, and parent ZIP downloads do not include this private metadata or
the companion files. XMP is bounded and parsed for a small metadata allowlist;
unsupported or unsafe metadata produces a private warning while preserving the
original companion. ACR is preserved as opaque bytes, not interpreted.

## Take the editable source back to Lightroom

Open a photo in the event organizer and choose **Download RAW + sidecars**.
The private archive contains the current RAW and its available XMP/ACR files,
with the same basename and original file contents. An image-only download for
parents does not include companions. A missing RAW must be uploaded before a
RAW archive is available.

## What stays in Lightroom

The app does not develop RAW files or apply Adobe adjustment recipes. Your
finished full-resolution JPEG remains the print and gallery authority. Updating
XMP does not change that JPEG or regenerate its appearance. Re-export and upload
the JPEG to change what parents see. Keep Lightroom catalog backups as well as
your originals.

Existing original-file downloads remain byte-for-byte uploads: this feature
does not scrub GPS or keywords already embedded in your exported JPEG/RAW.
Keep private tags in sidecars/catalog and use suitable metadata export settings
for parent-facing JPEGs.
