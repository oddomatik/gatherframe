import { hash, verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, schema } from './db';
import { nowIso } from './env';
import { randomToken, sha256 } from './secrets-ids';

export interface AdminUser { id: number; email: string; }
export const ADMIN_COOKIE = 'pk_admin';
const SESSION_DAYS = 14;

export async function hashPassword(pw: string): Promise<string> { return hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
export async function verifyPassword(hashed: string, pw: string): Promise<boolean> { try { return await verify(hashed, pw); } catch { return false; } }

export function adminCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.adminUsers).get()?.n ?? 0;
}

export async function createAdmin(email: string, password: string): Promise<AdminUser> {
  const row = db.insert(schema.adminUsers).values({ email: email.trim().toLowerCase(), passwordHash: await hashPassword(password), createdAt: nowIso() }).returning().get();
  return { id: row.id, email: row.email };
}

export async function authenticate(email: string, password: string): Promise<AdminUser | null> {
  const user = db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email.trim().toLowerCase())).get();
  if (!user) { await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password); return null; }
  return (await verifyPassword(user.passwordHash, password)) ? { id: user.id, email: user.email } : null;
}

export function createSession(userId: number, cookies: Cookies, secure: boolean): void {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.insert(schema.adminSessions).values({ id: sha256(token), userId, expiresAt: expires.toISOString(), createdAt: nowIso() }).run();
  cookies.set(ADMIN_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires });
}

export function destroySession(cookies: Cookies): void {
  const token = cookies.get(ADMIN_COOKIE);
  if (token) db.delete(schema.adminSessions).where(eq(schema.adminSessions.id, sha256(token))).run();
  cookies.delete(ADMIN_COOKIE, { path: '/' });
}

export function adminFromCookies(cookies: Cookies): AdminUser | null {
  const token = cookies.get(ADMIN_COOKIE);
  if (!token) return null;
  const row = db.select({ id: schema.adminUsers.id, email: schema.adminUsers.email, expiresAt: schema.adminSessions.expiresAt })
    .from(schema.adminSessions).innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminSessions.userId))
    .where(eq(schema.adminSessions.id, sha256(token))).get();
  if (!row) return null;
  if (row.expiresAt < nowIso()) { db.delete(schema.adminSessions).where(eq(schema.adminSessions.id, sha256(token))).run(); return null; }
  // Sliding expiry: extend when under 7 days remain.
  if (new Date(row.expiresAt).getTime() - Date.now() < 7 * 86400_000)
    db.update(schema.adminSessions).set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() }).where(eq(schema.adminSessions.id, sha256(token))).run();
  return { id: row.id, email: row.email };
}
