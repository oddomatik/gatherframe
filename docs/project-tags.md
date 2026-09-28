# Project-defined tags and shared filters

Every project starts with its own empty tag hierarchy. No fixed Day 1 / Day 2 list.

## Owner workflow

1. Open the event and **Project tags → Create tag**. Give it any label, and optionally choose **Inside** to nest it under another tag.
2. Examples (not templates): `Groups / Group 1`, `Activities / Playground`, or `Dates / Friday`. A parent tag includes all its descendants.
3. Choose whether the label can be shown/shared with parents. Tags are private by default; all ancestors must also allow sharing. XMP keywords/ratings stay private and are not automatically published or copied into tags.
4. Select photos, use **Tag selected photos**, check one or several tags, and add/remove them in bulk. Your selection stays selected. No photos are moved and no files are copied.
5. Filter by a branch or several branches. **Match any** is a union; **Match all** is an intersection. Existing filename, capture-date and private rating filters are still available.
6. For a shareable tag, **Open link / Copy** shares the whole branch. **Copy filtered link** shares a combination of tags, optionally within the currently selected child collection. It does not share private filename/rating/date searches.
7. Future uploads may select several existing tags for new photos. Later RAW/social/XMP versions retain the photo's existing tags.

**Organize photos** remains the child-collection workflow: mixed solo/shared batches can go to several children. Tagging is not filing, so it does not remove a photo from To sort.

## What a parent link means

A link is a saved browsing filter, not a separate access grant. It follows the event's publication, password and expiry. Only ready photos filed into active non-intake collections appear. Tagging an intake photo does not publish it. Parents can clear filters to browse the rest of the accessible event. Private tag names and Lightroom metadata are never serialized to parent pages.

Each branch has an opaque stable identifier, so renaming and reparenting preserve its URL. Current descendants determine the results. Making a tag/ancestor private disables links to that branch. Removed or unknown filters return not found, not an unfiltered gallery. Parent covers/counts and downloads follow the filter; shared shots are counted once.

## Existing data

Migration `0007_project_tag_hierarchy` adds `tags` and `photo_tags`. It copies only actually-used legacy day labels into `Days / Day N`, preserving all original rows, memberships, filenames, accounts and sessions. Empty projects get no tags, and unused Day 2 is not created. Existing `?day=N` links map to migrated tags while those tags exist. The legacy column/action remains only for older clients; the current UI uses tags.

No B2/LAN changes or password resets. No automatic Lightroom keyword import, face recognition or time-based grouping.
