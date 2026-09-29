import { sqlite } from './db';

export const demoEnabled = process.env.DEMO_MODE === '1';
export const DEMO_FIXTURE = 'gatherframe-showcase-v1';

/** A demo must be explicitly seeded into an empty, separate data directory. */
export function assertDemoFixture() {
  if (!demoEnabled) return;
  const marker = sqlite.prepare("SELECT value FROM settings WHERE key='demoFixture'").get() as { value: string } | undefined;
  const owners = sqlite.prepare('SELECT id, email FROM admin_users').all() as { id: number; email: string }[];
  if (!marker || JSON.parse(marker.value).v !== DEMO_FIXTURE || owners.length !== 1 || owners[0].id !== 1 || owners[0].email !== 'studio@example.invalid')
    throw new Error('DEMO_MODE requires an isolated, seeded demo fixture. Refusing to expose an ordinary studio.');
  for (const key of ['smtp', 'gotify', 'webhook']) {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    if (row && JSON.parse(row.value).v) throw new Error('External notifications must be disabled in the demo.');
  }
  if (process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY || process.env.SETUP_ENABLED === '1')
    throw new Error('Demo must not enable setup or external storage credentials.');
}

/** Shared fixture content is read-only; quote/download preparation is transient. */
export function demoWriteAllowed(method: string, pathname: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return method === 'POST' && /^\/g\/[^/]+\/api\/(quote|zip)$/.test(pathname);
}
