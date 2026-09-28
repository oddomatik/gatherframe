import { expect, it } from 'vitest';
import { canTransition } from './orders';

it('follows the fulfilment ladder and allows cancel before delivery', () => {
  expect(canTransition('new', 'in_progress')).toBe(true);
  expect(canTransition('printed', 'delivered')).toBe(true);
  expect(canTransition('new', 'delivered')).toBe(false);
  expect(canTransition('delivered', 'cancelled')).toBe(false);
  expect(canTransition('in_progress', 'cancelled')).toBe(true);
});
