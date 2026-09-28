/**
 * Venmo deep links. Venmo's URL format is undocumented, so both templates live in settings
 * and the handle is always shown as plain text next to the button.
 */
export const DEFAULT_VENMO_HTTPS = 'https://venmo.com/u/{handle}?txn=pay&amount={amount}&note={note}';
export const DEFAULT_VENMO_APP = 'venmo://paycharge?txn=pay&recipients={handle}&amount={amount}&note={note}';

export function buildVenmoLink(opts: {
  handle: string; amountCents: number; note: string; template?: string;
}): string {
  const handle = opts.handle.trim().replace(/^@/, '');
  const amount = (opts.amountCents / 100).toFixed(2);
  const tpl = opts.template ?? DEFAULT_VENMO_HTTPS;
  return tpl
    .replace('{handle}', encodeURIComponent(handle))
    .replace('{amount}', amount)
    .replace('{note}', encodeURIComponent(opts.note));
}
