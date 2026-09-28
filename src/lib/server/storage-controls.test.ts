import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ status: vi.fn(), test: vi.fn(), save: vi.fn() }));
vi.mock('$server/blob-store', () => ({ storageStatus: mock.status, testStorageConnection: mock.test, setStorageMode: mock.save }));
import { actions, load } from '../../routes/admin/storage/+page.server';

const status = {
  mode: 'local' as const, configured: true, endpoint: 'https://s3.us-west-004.backblazeb2.com',
  bucket: 'fixture-private', prefix: 'picture-day', counts: { local: 3, remote: 2 },
  testedAt: '2026-09-25T12:00:00.000Z'
};
function event(mode = 'local', authenticated = true) {
  return {
    locals: { admin: authenticated ? { id: 1, email: 'owner@example.test' } : null },
    request: new Request('https://fixture.invalid/admin/storage', {
      method: 'POST', body: new URLSearchParams({ mode }), headers: { origin: 'https://fixture.invalid' }
    })
  };
}
const action = (name: keyof typeof actions, requestEvent: ReturnType<typeof event>) => actions[name]!(requestEvent as never);

beforeEach(() => {
  vi.resetAllMocks();
  mock.status.mockResolvedValue(status);
  mock.test.mockResolvedValue(undefined);
  mock.save.mockResolvedValue(undefined);
});

describe('owner storage controls', () => {
  it('requires an owner login before loading status or executing either action', async () => {
    await expect(load(event('local', false) as never)).rejects.toMatchObject({ status: 303, location: '/admin/login' });
    for (const name of ['test', 'save'] as const) {
      expect(await action(name, event('b2', false))).toMatchObject({ status: 401 });
    }
    expect(mock.status).not.toHaveBeenCalled();
    expect(mock.test).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('returns only the non-secret status fields even if the adapter grows new fields', async () => {
    mock.status.mockResolvedValue({ ...status, applicationKey: 'never-render-this', keyId: 'never-render-id', counts: { ...status.counts, secret: 'never-render-count' } });
    const result = await load(event() as never);
    expect(result).toEqual({ backup: null, storage: status });
    expect(JSON.stringify(result)).not.toContain('never-render');
  });

  it('keeps local available without B2 configuration and rejects remote modes', async () => {
    mock.status.mockResolvedValue({ ...status, configured: false, testedAt: null });
    expect(await action('save', event('local'))).toHaveProperty('ok');
    expect(mock.save).toHaveBeenCalledExactlyOnceWith('local');
    for (const mode of ['b2', 'mirror']) expect(await action('save', event(mode))).toMatchObject({ status: 400 });
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(await action('test', event())).toMatchObject({ status: 400 });
    expect(mock.test).not.toHaveBeenCalled();
  });

  it('requires a successful test for remote choices and accepts only explicit known modes', async () => {
    mock.status.mockResolvedValue({ ...status, testedAt: null });
    expect(await action('save', event('b2'))).toMatchObject({ status: 400 });
    mock.status.mockResolvedValue(status);
    expect(await action('save', event('not-a-mode'))).toMatchObject({ status: 400 });
    expect(mock.save).not.toHaveBeenCalled();
    for (const mode of ['b2', 'mirror']) {
      expect(await action('save', event(mode))).toHaveProperty('ok');
      expect(mock.save).toHaveBeenLastCalledWith(mode);
    }
  });

  it('tests the connection without changing the selected storage mode', async () => {
    expect(await action('test', event())).toHaveProperty('ok');
    expect(mock.test).toHaveBeenCalledOnce();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('does not disclose errors containing credentials or signed requests', async () => {
    const sensitive = new Error('Credential=private-key-id signature=private-signature secret=private-app-key');
    mock.test.mockRejectedValue(sensitive);
    mock.save.mockRejectedValue(sensitive);
    for (const name of ['test', 'save'] as const) {
      const result = await action(name, event('b2'));
      expect(result).toMatchObject({ status: 400 });
      expect(JSON.stringify(result)).not.toMatch(/private-key-id|private-signature|private-app-key/);
    }
  });
});
