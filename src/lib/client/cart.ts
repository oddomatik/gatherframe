import type { CartItem, PricedCart } from '$shared/pricing';
import { clientUuid } from './ids';

export interface StoredCart {
  version: 1;
  idempotencyKey: string;
  items: CartItem[];
  customer: { name: string; phone: string; email: string; subjectName: string; notes: string; photoRequests?: Record<string,string>; emailUpdates?: boolean };
  updatedAt: number;
  pendingQuote?: PricedCart & { quoteToken: string };
  pendingOrder?: { cart: CartItem[]; quoteToken: string; idempotencyKey: string; customer: { name: string; phone: string | null; email: string | null; subjectName: string | null; notes: string | null; photoRequests?: Record<string,string>; emailUpdates?: boolean }; website: string };
}

function key(eventId: number): string { return `pk_cart_${eventId}`; }

export function newIdempotencyKey(): string {
  return clientUuid();
}

export function emptyCart(): StoredCart {
  return { version: 1, idempotencyKey: newIdempotencyKey(), items: [], customer: { name: '', phone: '', email: '', subjectName: '', notes: '', photoRequests: {}, emailUpdates: false }, updatedAt: Date.now() };
}

export function loadCart(eventId: number): StoredCart {
  try {
    const raw = localStorage.getItem(key(eventId));
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as StoredCart;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return emptyCart();
    parsed.customer.photoRequests ??= {};
    parsed.customer.emailUpdates ??= false;
    return parsed;
  } catch { return emptyCart(); }
}

export function saveCart(eventId: number, cart: StoredCart): boolean {
  try { localStorage.setItem(key(eventId), JSON.stringify({ ...cart, updatedAt: Date.now() })); return true; } catch { return false; }
}

export function clearCart(eventId: number): void { try { localStorage.removeItem(key(eventId)); } catch { /* ignore */ } }

export function itemKey(): string { return clientUuid(); }

/** Save the exact attempt before crossing the network. Repeated calls never replace an uncertain attempt. */
export function stageOrder(eventId: number, cart: StoredCart, quote: PricedCart & { quoteToken: string }): boolean {
  if (cart.pendingOrder) return true;
  const selected = new Set(cart.items.flatMap(i => i.sheets.flatMap(s => s.cells.map(c => String(c.photoId)))));
  const photoRequests = Object.fromEntries(Object.entries(cart.customer.photoRequests ?? {}).filter(([id,note]) => selected.has(id) && note.trim()).map(([id,note])=>[id,note.trim()]));
  cart.pendingOrder = JSON.parse(JSON.stringify({ cart: cart.items, quoteToken: quote.quoteToken, idempotencyKey: cart.idempotencyKey, customer: { name: cart.customer.name, phone: cart.customer.phone || null, email: cart.customer.email || null, subjectName: cart.customer.subjectName || null, notes: cart.customer.notes || null, photoRequests, emailUpdates: !!cart.customer.emailUpdates }, website: '' }));
  cart.pendingQuote = JSON.parse(JSON.stringify(quote));
  if (saveCart(eventId, cart)) return true;
  cart.pendingOrder = undefined; cart.pendingQuote = undefined;
  return false;
}

/** Missing previews are not evidence a selected photo was deleted. Never mutate the saved choices. */
export async function recoverPhotoChoices<T extends { id: number }>(
  items: CartItem[], known: T[], collectionIds: string[], fetchCollection: (id: string) => Promise<T[]>
): Promise<{ photos: T[]; unresolvedIds: number[]; failedCollections: string[] }> {
  const choices = new Set(items.flatMap(i => i.sheets.flatMap(s => s.cells.flatMap(c => c.photoId == null ? [] : [c.photoId]))));
  const byId = new Map(known.map(p => [p.id, p]));
  const failedCollections: string[] = [];
  if ([...choices].some(id => !byId.has(id))) {
    const results = await Promise.allSettled(collectionIds.map(id => fetchCollection(id)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') for (const photo of result.value) byId.set(photo.id, photo);
      else failedCollections.push(collectionIds[i]);
    });
  }
  return { photos: [...byId.values()], unresolvedIds: [...choices].filter(id => !byId.has(id)), failedCollections };
}
