import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCart, emptyCart, loadCart, recoverPhotoChoices, stageOrder } from './cart';
import type { CartItem, PricedCart } from '../shared/pricing';

const items: CartItem[] = [{ key: 'family-print', productId: 4, quantity: 1, sheets: [{ templateCode: 'test', cells: [{ cellIndex: 0, photoId: 11 }, { cellIndex: 1, photoId: 72 }] }] }];
const quote: PricedCart & { quoteToken: string } = { items: [], subtotalCents: 2500, totalCents: 2500, currency: 'USD', complete: true, quoteToken: 'accepted-price-and-poses' };
function storage() {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
}
afterEach(() => vi.unstubAllGlobals());

describe('order recovery across a lost response', () => {
  it('freezes photo requests and consent on the exact attempt, excluding removed photos',()=>{
    storage(); const cart=emptyCart();cart.items=structuredClone(items);
    cart.customer.photoRequests={'11':' Please keep this crop ','999':'Removed'};cart.customer.emailUpdates=true;
    expect(stageOrder(2,cart,quote)).toBe(true);
    expect(cart.pendingOrder!.customer.photoRequests).toEqual({'11':'Please keep this crop'});
    cart.customer.photoRequests={'11':'Changed'};cart.customer.emailUpdates=false;
    stageOrder(2,cart,quote);expect(loadCart(2).pendingOrder!.customer).toMatchObject({photoRequests:{'11':'Please keep this crop'},emailUpdates:true});
  });
  it('restores the exact submitted sibling selections, contact and accepted price after restart even if the draft was edited', () => {
    storage();
    const cart = emptyCart(); cart.items = structuredClone(items); cart.customer = { name: 'A parent', phone: '5550100', email: '', subjectName: 'Two siblings', notes: '' };
    const key = cart.idempotencyKey;
    expect(stageOrder(2, cart, quote)).toBe(true);
    const attempt = structuredClone(cart.pendingOrder);
    cart.items[0].sheets[0].cells[1].photoId = 999;
    cart.customer.phone = 'new contact';
    expect(stageOrder(2, cart, { ...quote, totalCents: 4000, quoteToken: 'changed-price' })).toBe(true);
    expect(cart.pendingOrder).toEqual(attempt);
    const restored = loadCart(2);
    expect(restored.idempotencyKey).toBe(key);
    expect(restored.pendingOrder).toEqual(attempt);
    expect(restored.pendingOrder!.cart[0].sheets[0].cells[1].photoId).toBe(72);
    expect(restored.pendingQuote!.totalCents).toBe(2500);
    clearCart(2);
    expect(loadCart(2).idempotencyKey).not.toBe(key);
    expect(loadCart(2).items).toEqual([]);
  });
  it('does not allow a first request when browser storage cannot journal the attempt', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); } });
    const cart = emptyCart(); cart.items = structuredClone(items);
    expect(stageOrder(2, cart, quote)).toBe(false);
    expect(cart.pendingOrder).toBeUndefined();
    expect(cart.pendingQuote).toBeUndefined();
    expect(cart.items).toEqual(items);
  });
});

describe('saved photo choices during partial or transient gallery failure', () => {
  it('keeps both siblings selected when a failed collection hides one preview, then recovers it on retry', async () => {
    const saved = structuredClone(items);
    const first = await recoverPhotoChoices(saved, [{ id: 11 }], ['other-child', 'shared-friends'], async id => {
      if (id === 'other-child') throw new Error('temporary offline');
      return [{ id: 88 }];
    });
    expect(first.failedCollections).toEqual(['other-child']);
    expect(first.unresolvedIds).toEqual([72]);
    expect(saved).toEqual(items);
    const retry = await recoverPhotoChoices(saved, first.photos, ['other-child'], async () => [{ id: 72 }, { id: 11 }]);
    expect(retry.unresolvedIds).toEqual([]);
    expect(retry.photos.filter(p => p.id === 11)).toHaveLength(1);
    expect(saved).toEqual(items);
  });
  it('also preserves a choice absent from every successful response for explicit review, not silent deletion', async () => {
    const saved = structuredClone(items);
    const result = await recoverPhotoChoices(saved, [{ id: 11 }], ['other-child'], async () => []);
    expect(result.unresolvedIds).toEqual([72]);
    expect(saved).toEqual(items);
  });
});
