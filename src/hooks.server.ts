import type { Handle, HandleServerError } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { adminFromCookies } from '$server/auth';
import { startWorkers } from '$server/workers';
import { assertDemoFixture, demoEnabled, demoWriteAllowed } from '$server/demo';

assertDemoFixture();
startWorkers();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = randomUUID().slice(0, 8);
  event.locals.demo = demoEnabled;
  event.locals.admin = adminFromCookies(event.cookies);
  const p = event.url.pathname;
  if (demoEnabled) {
    if (p === '/setup' || p.startsWith('/setup/')) return new Response('Not found', { status: 404 });
    // Keep the example metrics illustrative, not a record of demo visitors.
    if (event.request.method === 'POST' && /^\/g\/[^/]+\/api\/activity$/.test(p)) return new Response(null, { status: 204 });
    if (!demoWriteAllowed(event.request.method, p)) return new Response(JSON.stringify({ error: 'This is a read-only demo. Changes and order submission are disabled.' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (p === '/admin/login') return new Response(null, { status: 303, headers: { location: '/admin' } });
    if (p === '/admin' || p.startsWith('/admin/')) event.locals.admin = { id: 1, email: 'studio@example.invalid' };
  }
  if (p === '/favicon.ico') return new Response(null, { status: 301, headers: { location: '/favicon.svg', 'cache-control': 'public, max-age=86400' } });

  // Authenticate before SvelteKit dispatches any page action (layouts run too late).
  const adminRoute = p === '/admin' || p.startsWith('/admin/');
  if (adminRoute && p !== '/admin/login' && !event.locals.admin) {
    if (event.request.method === 'GET' && !p.startsWith('/admin/api/')) return new Response(null, { status: 303, headers: { location: '/admin/login' } });
    return new Response(JSON.stringify({ error: 'Please sign in first' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  if (adminRoute && !p.startsWith('/admin/preview/')) event.cookies.delete('pk_parent_preview', { path: '/' });

  // Admin JSON API: same-origin only (cookie session + JSON/PUT bodies).
  if (p.startsWith('/admin/api/')) {
    const site = event.request.headers.get('sec-fetch-site');
    const origin = event.request.headers.get('origin');
    const sameOrigin = site ? site === 'same-origin' || site === 'none' : !origin || origin === event.url.origin;
    if (!sameOrigin) return new Response('cross-site request refused', { status: 403 });
    if (!event.locals.admin) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const response = await resolve(event);
  if(adminRoute) response.headers.set('cache-control','private, no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'same-origin');
  response.headers.set('x-frame-options', 'SAMEORIGIN');
  if (demoEnabled) { response.headers.set('x-robots-tag', 'noindex, nofollow'); response.headers.set('cache-control', 'private, no-store'); }
  if (p.startsWith('/g/') || p.startsWith('/o/') || p.startsWith('/media/') || p.startsWith('/share/')) {
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    // Authorized image handlers choose private caching; pages, errors and
    // downloads must not inherit that policy.
    if ((!p.startsWith('/media/') && !p.startsWith('/share/')) || ![200, 304].includes(response.status) || !response.headers.has('cache-control'))
      response.headers.set('cache-control', 'private, no-store');
  }
  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[${event.locals.requestId}] ${event.request.method} ${event.url.pathname.replace(/\/g\/s_[A-Za-z0-9_-]{43}/g,'/g/[invitation]')}`, error);
  return { message: 'Something went wrong on our side. Please try again.' };
};
