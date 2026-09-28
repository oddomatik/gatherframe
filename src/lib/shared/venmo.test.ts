import { expect, it } from 'vitest';
import { buildVenmoLink, DEFAULT_VENMO_APP } from './venmo';

it('builds the https link with amount and encoded note', () => {
  expect(buildVenmoLink({ handle: '@Brian-Andrus', amountCents: 4800, note: 'PO-20261005-3F2A Emma R' }))
    .toBe('https://venmo.com/u/Brian-Andrus?txn=pay&amount=48.00&note=PO-20261005-3F2A%20Emma%20R');
});
it('builds the app link from the template', () => {
  expect(buildVenmoLink({ handle: 'x', amountCents: 1000, note: 'n', template: DEFAULT_VENMO_APP }))
    .toBe('venmo://paycharge?txn=pay&recipients=x&amount=10.00&note=n');
});
