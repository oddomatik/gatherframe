# Gallery presentation

Gatherframe keeps one project/photo/collection model while supporting different ways to browse a shoot. One photo can belong to several collections without copying its files.

## Choose an entry layout

Open a project → **Presentation → Gallery layout**:

- **Collection directory:** recognizable covers and collection cards. Existing projects keep this layout, with anonymous titles unless you deliberately supply public text.
- **Simple gallery:** the project link opens directly to all ready, filed photos, once each. Useful for portraits, headshots and small deliveries. You do not need to make visitors choose a collection first.
- **Story / sections:** ordered chapter headings, introductions and up to twelve preview photos per section, followed by a link to all its photos. Use this for a wedding, travel story or multipart project.

All layouts use the existing photos, collection memberships, tags, download policies and guest-access checks. Changing layout never publishes a draft, files an intake photo, changes a password or enables orders. **To sort stays private.** Simple galleries still require deliberate filing into at least one active collection; they are not automatic publication of every upload.

New projects created in the studio default to **Simple gallery** and print orders off. Choose another layout or enable orders when creating the project. Existing projects and older creation clients retain their previous defaults. Dates are optional; Projects replaces Events in visible navigation, not in stored identifiers or existing links.

## Public titles are separate from private labels

Under Presentation, choose a collection and enter its optional **Public title** and **Public description**. This is the only collection text exposed to guests. Internal labels are never copied into these fields automatically. Blank titles keep the anonymous collection label/“Your photos” behavior.

For example, a private label can be `Ceremony selects`, while the public title is `The ceremony`. Descriptions are plain text, not HTML. Clearing a public field removes it from guest presentation without renaming the collection.

## Curate the sequence

- **Collection display order** controls the directory and story chapters. The studio sidebar stays name-sorted for finding collections.
- **Photo sequence** applies only to the selected collection. The same image can be first in Highlights and twentieth in Ceremony. Use the labeled earlier/later buttons with a pointer or keyboard, then save.
- Newly added photos follow the saved sequence in automatic shot order.
- **Restore automatic photo order** clears that collection's custom sequence and saves its current public text. Project-wide browsing retains automatic photo order.
- A stale editor is rejected if the sequence or membership changed elsewhere. Reload before retrying; no partial order is saved. Changing collection membership does not rewrite photo IDs, original files or accepted print masters.

Unfinished presentation edits survive tab changes and unrelated saves. Switching collections or leaving the project warns before discarding edits.

Cover pins continue to take precedence. An automatic cover uses the applicable collection sequence, while retaining the project's exclusive-photo preference.

## Optional sales

Enable **Accept print orders** in Project settings when needed. The Sales tab and sales-only settings appear for that project; guest print-order actions follow the same setting. Disabling sales preserves the saved catalog, pricing, pickup instructions, order references and historical orders. Storage is available through **Studio settings → Storage & media**.

## What this does not change

Ordinary collection links remain browsing views, not access grants. Public titles do not create permissions. Use [scoped invitations and proof selections](scoped-sharing-and-proofing.md) for restricted delivery and explicit submissions; favorites remain separate and browser-local. Cross-project photo reuse, client/CRM entities and nested collection trees remain separate capabilities.

## Upgrade and verification

Migration `0016_gallery_presentation` adds the layout, explicit public fields and nullable collection-membership positions. Existing values, files, IDs, URLs and order references are retained; public text starts blank and layout defaults to the existing directory. Older binaries refuse this schema: recover with a compatible release or a verified pre-upgrade database/media snapshot, not an in-place binary downgrade.

Focused coverage: `src/lib/server/presentation.test.ts` tests migration preservation, private labels, visibility, independent ordering, invalid/stale edits and authorization. After a production build, `node scripts/verify-presentation.mjs` rehearses the studio and guest layouts using disposable synthetic data; optional screenshots/report go to `PRESENTATION_ARTIFACTS`. It is included in `npm run test:e2e`. Browser viewport tests do not certify physical-phone behavior.
