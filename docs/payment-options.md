# Cash and Venmo payment UX

Cash in person is a first-class payment option before submitting an order and
on its confirmation. Confirmation payment options precede the selected-print
list. No payment preference, payment record or paid status is inferred from
viewing or clicking either option; the studio still records payments.

Venmo no longer switches one link's destination after client-side iOS/Android
detection. The primary HTTPS profile/payment link and an explicit `Open Venmo
app` link are both rendered on the server as normal external anchors. There is
no async click handler, popup, timer, or automatic redirect. The HTTPS route
provides an alternative to the previously mandatory mobile custom scheme; it
is not a guarantee that iOS will open an installed app. Existing configurable
URL templates are retained, with normalized handle whitespace.

`Venmo didn’t open?` reveals selectable/copyable handle, remaining amount and
order reference. Recognized embedded browsers open this help initially; the
customer then controls the disclosure. Denied clipboard access leaves the details
selectable. Owner payment instructions are preserved.

Partial payments reduce both destinations' amount and the cash amount. Paid
and canceled orders have no invitation to send another payment. Unconfigured
Venmo leaves cash visible without a broken link. These changes don't introduce
merchant checkout, automatic payment reconciliation, or real payment testing.
