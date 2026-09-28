import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/auth', () => ({
  adminCount: vi.fn(() => 0), createAdmin: vi.fn(), createSession: vi.fn()
}));
vi.mock('$server/settings', () => ({ updateSettings: vi.fn() }));
vi.mock('$server/catalog', () => ({ ensureCatalog: vi.fn() }));

import { adminCount, createAdmin } from '$server/auth';
import { actions, load } from './+page.server';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('first-owner deployment boundary', () => {
  it.each(['0', undefined, 'typo'])('rejects setup GET and POST when setup is %s', async (setting) => {
    vi.stubEnv('SETUP_ENABLED', setting);
    expect(() => load({} as never)).toThrowError(expect.objectContaining({ status: 404 }));
    const formData = vi.fn(() => new FormData());
    await expect(actions.default!({ request: { formData } } as never)).rejects.toMatchObject({ status: 404 });
    expect(formData).not.toHaveBeenCalled();
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it('allows the setup form only while enabled and before the first owner exists', () => {
    vi.stubEnv('SETUP_ENABLED', '1');
    expect(load({} as never)).toEqual({});
    vi.mocked(adminCount).mockReturnValueOnce(1);
    expect(() => load({} as never)).toThrowError(expect.objectContaining({ status: 302, location: '/admin' }));
  });
});
