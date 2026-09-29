# Owner print preparation

Open **Orders → an order → Print preparation**. Payment collection remains separate.

1. Read the original customer comment and add any requests received personally.
2. Review each distinct ordered photo, regardless of how many sizes it appears in. Use **Needs touch-up** and a private note when work is needed. Click its thumbnail for a large current-edit preview, filmstrip, or comparison.
3. Finish corrections in Lightroom and re-upload the full-resolution JPEG with the same project/filename and explicit replacement enabled. Also replace social copies if those should reflect the correction.
4. When a master changes, approve the exact new master using the existing reason/approval control. Then review the photo again and mark it **Ready to print**. The old review cannot authorize changed bytes.
5. Mark special requests addressed. Once all photos and requests are reviewed, download production files and use the job ticket. Files can also be downloaded beforehand as **sources for touch-ups**, clearly labeled not approved for printing.
6. Mark **Printed**, then **Delivered**, when those real-world steps happen. These actions do not record payments or send jobs to a printer. Existing configured printed/delivered notifications remain unchanged.

## Details

- Orders can be filtered by Review, Touch-ups, or Ready to print.
- Extra requests and per-photo notes are private owner information. They appear on owner job tickets and ZIP pick lists, never the customer order page.
- Source availability and exact approved master checks apply to both source and production ZIPs. No social-image fallback is used for printing.
- Reopening a completed/canceled order preserves notes but clears its preparation approvals. Canceled orders cannot export print files.
- Saves use revision checks and durable request receipts: a stale tab cannot overwrite newer work, and retrying a lost response cannot apply a transition twice.
- Unsaved edits remain when another photo is saved or a preview is opened. Leaving prompts before discarding them. These notes are not an offline draft store; save before closing.
- Migration `0012_print_fulfillment` adds three tables only. Existing orders, selected photos, quantities, prices, payments, and order statuses are unchanged. Active orders initially need review; already printed/delivered orders keep their existing status.
