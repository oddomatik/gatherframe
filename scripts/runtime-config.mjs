export function validateRuntime(env) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.APP_SECRET || env.APP_SECRET.length < 32 || /^(change[-_]?me|example|replace[-_]?me)/i.test(env.APP_SECRET))
    throw Error('APP_SECRET must be a durable random secret of at least 32 characters. Generate .env before starting.');
  const origin = new URL(env.PUBLIC_ORIGIN || 'invalid:');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.PUBLIC_ORIGIN || origin.username || origin.password)
    throw Error('PUBLIC_ORIGIN must be an http(s) origin with no credentials, path or trailing slash.');
  if (env.ORIGIN && env.ORIGIN !== env.PUBLIC_ORIGIN) throw Error('ORIGIN must match PUBLIC_ORIGIN.');
  env.ORIGIN = env.PUBLIC_ORIGIN;
  if (env.SETUP_ENABLED !== undefined && !['0', '1'].includes(env.SETUP_ENABLED)) throw Error('SETUP_ENABLED must be 0 or 1.');
}
