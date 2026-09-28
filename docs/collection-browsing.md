# Collection browsing while sorting

**Live September 27, 2026** in `picture-day:b2591c2`, after the owner confirmed
upload completion. 

## Owner workflow

- Owner collection lists use natural, case-insensitive name order: Kid 2 before
  Kid 10. All photos and To sort remain first. Equal names use stable identity
  ties. New draft collections sort immediately; renamed collections move to
  their new position after saving.
- This ordering covers the event sidebar, archived list, assignment picker,
  combine/move destinations, upload destination, and per-photo membership
  labels. Existing stored sort values and public photo-first gallery ordering
  are unchanged.
- The sidebar has larger, uncropped covers, search for longer lists, and a
  **Browse collections** action. Browsing does not navigate away from or change
  the selected photo batch.
- In **Organize photos**, larger destination cards offer **View photos**.
  The collection browser shows existing photos in shot order. Its collection
  dropdown switches between name-sorted destinations.
- Click an existing photo for a larger preview with previous/next buttons and
  arrow keys. Escape or a backdrop click returns one modal level at a time.
- **Add N selected photos here** adds the current subset to the sorting draft;
  it does not save immediately. Return to sorting, choose another subset if
  needed, and use **Save & finish** to commit the reviewed assignments. Already
  assigned destinations cannot be toggled off accidentally from the browser.
- Inline-created collections can be inspected before saving using their local
  draft photos. Empty existing collections can be inspected and assigned to.

## Data boundaries

The browser uses the existing owner-only, event-scoped gallery-photo endpoint.
It explicitly authenticates, rejects archived/foreign destinations, and marks
the response private/no-store. Thumbnail images retain their existing private
versioned caching; large previews load only on demand. Switching collections
or closing the browser aborts pending reads; late responses cannot populate
the wrong collection. Failed reads show Retry and disable assignment until
the collection has loaded. No new storage or identity model is introduced.
