import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntime } from './runtime-config.mjs';
const valid = () => ({ NODE_ENV: 'production', APP_SECRET: 'a'.repeat(64), PUBLIC_ORIGIN: 'https://photos.example.com' });
test('production requires a stable secret and validates the origin before importing the app', () => {
  for (const secret of [undefined, '', 'change-me', 'short', 'change-me'.repeat(10)])
    assert.throws(() => validateRuntime({ ...valid(), APP_SECRET: secret }), /APP_SECRET/);
  for (const origin of ['', 'file:///data', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/'])
    assert.throws(() => validateRuntime({ ...valid(), PUBLIC_ORIGIN: origin }));
  assert.throws(() => validateRuntime({ ...valid(), ORIGIN: 'https://other.example.com' }), /ORIGIN/);
  assert.throws(() => validateRuntime({ ...valid(), SETUP_ENABLED: 'yes' }), /SETUP_ENABLED/);
  const env = valid(); validateRuntime(env); assert.equal(env.ORIGIN, env.PUBLIC_ORIGIN);
  assert.equal(env.SETUP_ENABLED, undefined);
});
