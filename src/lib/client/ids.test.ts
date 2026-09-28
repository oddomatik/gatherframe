import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientUuid } from './ids';
import { emptyCart, itemKey, newIdempotencyKey } from './cart';

afterEach(() => vi.unstubAllGlobals());
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('browser IDs on HTTPS and LAN HTTP', () => {
  it('uses native randomUUID when available with its required receiver', () => {
    const source = { randomUUID() { expect(this).toBe(source); return '9a213132-30e0-4e82-a405-dd5f3903e256'; } };
    vi.stubGlobal('crypto', source);
    expect(clientUuid()).toBe('9a213132-30e0-4e82-a405-dd5f3903e256');
  });

  it('formats secure random bytes with UUID version and variant bits when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0xff));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(clientUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  });

  it('creates distinct upload and cart IDs using getRandomValues alone on LAN HTTP', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = [...Array.from({ length: 1000 }, () => clientUuid()), emptyCart().idempotencyKey, itemKey(), newIdempotencyKey()];
    expect(ids.every((id) => uuidV4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not substitute insecure randomness when browser crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => clientUuid()).toThrow('Secure random numbers are unavailable');
  });
});
