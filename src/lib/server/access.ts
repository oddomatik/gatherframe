import type { Cookies } from '@sveltejs/kit';
import type { Event } from './db/schema';
import { verifyPassword } from './auth';
import { hmac, randomToken, safeEqual, sha256 } from './secrets-ids';
import { nowIso } from './env';

export const SID_COOKIE = 'pk_sid';
const ACCESS_DAYS = 30;

/** Anonymous visitor id used for rate limits, download-token binding and order attribution. */
export function visitorSid(cookies: Cookies, secure: boolean): string {
  let sid = cookies.get(SID_COOKIE);
  if (!sid || !/^[A-Za-z0-9_-]{16,64}$/.test(sid)) {
    sid = randomToken(16);
    cookies.set(SID_COOKIE, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 365 * 86400 });
  }
  return sid;
}

export function passwordFingerprint(passwordHash: string | null): string { return passwordHash ? sha256(passwordHash).slice(0, 16) : ''; }

interface AccessClaims { eid: number; sid: string; pwfp: string; exp: number; }

function cookieName(eventId: number): string { return `pk_g_${eventId}`; }

export function grantEventAccess(event: Event, sid: string, cookies: Cookies, secure: boolean): void {
  const claims: AccessClaims = { eid: event.id, sid, pwfp: passwordFingerprint(event.passwordHash), exp: Date.now() + ACCESS_DAYS * 86400_000 };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  cookies.set(cookieName(event.id), `${body}.${hmac(body)}`, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: ACCESS_DAYS * 86400 });
}

function readClaims(value: string | undefined): AccessClaims | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig || !safeEqual(hmac(body), sig)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessClaims;
    return c.exp > Date.now() ? c : null;
  } catch { return null; }
}

export type AccessState = 'ok' | 'locked' | 'expired' | 'unpublished';

/** Whether this visitor may view the event. Admin preview bypasses password, draft state and expiry. */
export function eventAccessState(event: Event, cookies: Cookies, isAdmin: boolean): AccessState {
  if (isAdmin) return 'ok';
  if (!event.isPublished) return 'unpublished';
  if (event.expiresAt && event.expiresAt < nowIso()) return 'expired';
  if (!event.passwordHash) return 'ok';
  const claims = readClaims(cookies.get(cookieName(event.id)));
  if (!claims || claims.eid !== event.id || claims.sid !== cookies.get(SID_COOKIE)) return 'locked';
  if (!safeEqual(claims.pwfp, passwordFingerprint(event.passwordHash))) return 'locked';
  return 'ok';
}

export async function tryUnlock(event: Event, password: string, sid: string, cookies: Cookies, secure: boolean): Promise<boolean> {
  if (!event.passwordHash) return true;
  const ok = await verifyPassword(event.passwordHash, password);
  if (ok) grantEventAccess(event, sid, cookies, secure);
  return ok;
}
