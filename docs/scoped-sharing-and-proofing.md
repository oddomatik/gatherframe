# Scoped invitations and proof selections

Open a project → **Sharing → Manage scoped invitations & proofing**.

## Share only selected collections

Create an invitation with a **private recipient label**, one or more active collections, an optional expiry (entered in UTC), and whether to allow the project's enabled original/version downloads. Copy the generated link immediately: only its cryptographic digest is stored. The label is not exposed to guests and is not identity verification. Anyone holding the link can use it; send it through your own trusted channel.

An invitation displays only its allowed collections and their ready photos. Shared photos appear once in project-wide browsing. Tags, counts, related collections, photo redirects, print selections, original files and ZIP downloads all use that same scope. A view-only invitation still shows previews, which a visitor can save; it is not DRM. Project-wide download settings can narrow, but not be widened by, the invitation. Print ordering remains optional at project level and uses only allowed photos.

**Scopes are live:** photos deliberately added to an allowed collection become visible. Removing membership or archiving a collection removes access, even when the photograph belongs to a different, disallowed collection. To change which collections an invitation includes, create a replacement and revoke the old invitation. Intake/To sort remains private.

### Close the broad-link loophole deliberately

Existing projects keep their broad gallery links for compatibility. **Creating an invitation alone does not make a project private.** After creating an active scoped invitation, enable **Only allow scoped invitations**. Guests can no longer use the broad project URL, its promotional share image, or previously minted broad gallery-media/download capabilities. Photographer previews remain available.

Independent saved-order receipt links remain valid for their own order; they do not grant album access. Previously downloaded files and a response already being transferred cannot be recalled. Switching this setting off intentionally re-enables the broad link; it is not an irreversible revoke operation.

### Rotate, revoke, expire

- **Rotate link** creates a new secret for the same invitation, invalidating the old URL and its media/ZIP capabilities. Proof rounds and their history remain associated with the invitation.
- **Revoke invitation** disables access and edits. It does not erase submissions. Create a new invitation to restore access.
- Expiry, project publication, project closing time and the project password are checked alongside invitation scope. Having another invitation or an existing password cookie never expands a scoped URL.
- Signed preview/thumbnail/cover URLs revalidate current grant version, expiry, membership and publication before conditional-cache responses. They are scoped bearer capabilities, not public permanent assets.

Scoped gallery pages omit project-wide social-preview artwork, which could show a different recipient's photographs. They use the normal three presentation layouts; a project cover is included only if it is in scope. For invitations with sensitive recipients, review the project title and studio-wide messages too: those remain shared project text.

## Collect an explicit proof selection

Each active invitation can have one or more **selection rounds**, with a public title such as “Choose your final images.” The recipient follows **Selection rounds** from that invitation, selects allowed photographs, adds optional photo notes and a message, then:

1. **Save draft:** persist the working selection on the server so it survives reloads/devices using that invitation.
2. **Submit selection:** create an immutable submission snapshot and lock further recipient edits.
3. The photographer opens the round from the invitation list, reviews selected images and notes, and **accepts**, **reopens for changes**, or **closes** the round. Feedback appears to the recipient. Reopening permits another submission without changing prior submission history.

This is not an order, payment approval or automatic retouching job. Favorites stay separate and browser-local. Submissions are attributable to the invitation, not an authenticated human identity. Anyone holding the same link shares its open draft; stale concurrent edits are rejected rather than silently replacing a newer draft. Exact submit retries do not duplicate history.

An accepted round cannot be edited by a recipient until reopened. A revoked/expired invitation cannot read or change any of its rounds. If a selected photo subsequently leaves scope, its ID/notes are removed from guest round data; the original submission remains visible to the photographer as review evidence. Owner submission history displays stable Photo IDs even if an asset has since been removed.

Limits: up to 2,000 selected photos, 500 characters per photo note, 20,000 total photo-note characters and a 2,000-character round message/feedback. No automatic recipient notifications are sent. External identity/login, collection-specific passwords, frozen scopes, per-version grant allowlists, e-signatures, threaded comments, global media libraries and nested collection builders are not part of this workflow.

## Upgrade and verification

Migration `0017_scoped_sharing_and_proofs` adds the opt-in broad-link restriction, invitation records, proof rounds and immutable submission records. Existing projects, IDs, files, links, orders and broad-access behavior are retained until an owner changes the access mode. Back up database/media before upgrading; an older binary cannot open the new schema safely. Roll back using a compatible binary or a verified pre-upgrade snapshot.

`src/lib/server/sharing-proofing.test.ts` verifies migration compatibility, scope intersection, capabilities, revocation and proof transitions. `scripts/verify-scopes-proofing.mjs` exercises the actual browser and HTTP boundaries on synthetic loopback fixtures, including cross-invitation requests, exact-byte originals/ZIPs, proof revisions and 390px layouts. It is included in `npm run test:e2e`; set `SCOPES_ARTIFACTS` to save local screenshots and a check report. These are not physical-phone or production certification.
