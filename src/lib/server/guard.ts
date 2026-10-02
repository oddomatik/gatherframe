import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { eventAccessState, visitorSid, type AccessState } from './access';
import { guestEventBySlug } from './sharing';
import type { Event } from './db/schema';

export interface EventContext { event: Event; state: AccessState; sid: string; isAdmin: boolean; secure: boolean; }

/** Resolve the event for /g/[slug]/** routes. Throws 404 for unknown/unpublished slugs (no enumeration signal). */
export function eventContext(e: Pick<RequestEvent, 'params' | 'cookies' | 'locals' | 'url'>): EventContext {
  const event = e.params.slug ? guestEventBySlug(e.params.slug) : undefined;
  if (!event) throw error(404, 'Not found');
  const secure = e.url.protocol === 'https:';
  const sid = visitorSid(e.cookies, secure);
  const isAdmin = !!e.locals.admin && e.cookies.get('pk_parent_preview') !== '1';
  const state = eventAccessState(event, e.cookies, isAdmin);
  if (state === 'unpublished') throw error(404, 'Not found');
  return { event, state, sid, isAdmin, secure };
}

/** For endpoints that hand out bytes: require full access. */
export function requireEventAccess(e: Pick<RequestEvent, 'params' | 'cookies' | 'locals' | 'url'>): EventContext {
  const ctx = eventContext(e);
  if (ctx.state === 'locked') throw error(401, 'Enter the gallery password first');
  if (ctx.state === 'expired') throw error(410, 'This gallery has expired');
  return ctx;
}

export function clientIp(e: RequestEvent): string | null {
  try { return e.getClientAddress(); } catch { return e.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }
}

export function cookiesSecure(cookies: Cookies, url: URL): boolean { void cookies; return url.protocol === 'https:'; }
