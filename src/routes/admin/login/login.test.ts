import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/auth', () => ({
  adminCount: vi.fn(() => 0), authenticate: vi.fn(), createSession: vi.fn()
}));
vi.mock('$server/orders', () => ({ countNewOrders: vi.fn(() => 0) }));
vi.mock('$server/settings', () => ({ getSettings: vi.fn(() => ({ studioName: 'Gatherframe' })) }));
vi.mock('$server/ratelimit', () => ({ rateLimit: vi.fn(() => ({ ok: true })) }));

import { adminCount, authenticate, createSession } from '$server/auth';
import { rateLimit } from '$server/ratelimit';
import { load as layoutLoad } from '../+layout.server';
import { actions, load } from './+page.server';

const loginEvent = () => ({ route: { id: '/admin/login' }, locals: { admin: null }, url: new URL('https://picture-day.test/admin/login') });

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('photographer access before and after owner setup', () => {
  it.each(['0', undefined, 'typo'])('renders a pending login state when setup is %s', (setting) => {
    vi.stubEnv('SETUP_ENABLED', setting);
    expect(layoutLoad(loginEvent() as never)).toMatchObject({ photographerAccessPending: true, admin: null });
    expect(load(loginEvent() as never)).toEqual({});
  });

  it.each(['1'])('preserves first-owner setup when SETUP_ENABLED is %s', (setting) => {
    vi.stubEnv('SETUP_ENABLED', setting);
    expect(() => layoutLoad(loginEvent() as never)).toThrowError(expect.objectContaining({ status: 302, location: '/setup' }));
  });

  it('rejects a pending login POST before reading credentials or attempting authentication', async () => {
    vi.stubEnv('SETUP_ENABLED', '0');
    const formData = vi.fn();
    const result = await actions.default!({ request: { formData } } as never);
    expect(result).toMatchObject({ status: 503, data: { error: expect.stringContaining('Photographer access is being set up') } });
    expect(formData).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('keeps login available when an owner exists, even with public setup disabled', async () => {
    vi.stubEnv('SETUP_ENABLED', '0');
    vi.mocked(adminCount).mockReturnValueOnce(1).mockReturnValueOnce(1);
    expect(layoutLoad(loginEvent() as never)).toMatchObject({ photographerAccessPending: false });
    vi.mocked(authenticate).mockResolvedValueOnce({ id: 'owner' } as never);
    const form = new FormData();
    form.set('email', 'owner@example.test');
    form.set('password', 'test-only-password');
    const event = { ...loginEvent(), request: { formData: async () => form }, cookies: {}, getClientAddress: () => '127.0.0.1' };
    await expect(actions.default!(event as never)).rejects.toMatchObject({ status: 303, location: '/admin' });
    expect(authenticate).toHaveBeenCalledWith('owner@example.test', 'test-only-password');
    expect(createSession).toHaveBeenCalledWith('owner', event.cookies, true);
  });
});
