import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { nowIso } from './env';
import { open, seal } from './secrets';
import { DEFAULT_SUFFIX_PATTERNS, type VariantRole } from '$shared/stem';
import { DEFAULT_VENMO_APP, DEFAULT_VENMO_HTTPS } from '$shared/venmo';

export interface SmtpSettings { host: string; port: number; secure: boolean; user: string; pass: string; from: string; }
export interface GotifySettings { url: string; token: string; priority: number; }
export interface WebhookSettings { url: string; secret: string; }

export interface Settings {
  studioName: string;
  photographerName: string;
  contactLine: string;
  currency: string;
  adminEmail: string;
  venmoHandle: string;
  venmoTemplateHttps: string;
  venmoTemplateApp: string;
  paymentInstructionsMd: string;
  stemSuffixPatterns: Record<string, VariantRole>;
  orderTz: string;
  smtp: SmtpSettings | null;
  gotify: GotifySettings | null;
  webhook: WebhookSettings | null;
  notifyEmail: boolean;
  notifyGotify: boolean;
  notifyWebhook: boolean;
  zipStreamMaxBytes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  studioName: 'Photo Studio',
  photographerName: '',
  contactLine: '',
  currency: 'USD',
  adminEmail: '',
  venmoHandle: '',
  venmoTemplateHttps: DEFAULT_VENMO_HTTPS,
  venmoTemplateApp: DEFAULT_VENMO_APP,
  paymentInstructionsMd: "If you'd like to pay now, here is Venmo. Otherwise I'll collect cash in person.",
  stemSuffixPatterns: DEFAULT_SUFFIX_PATTERNS,
  orderTz: 'America/Los_Angeles',
  smtp: null,
  gotify: null,
  webhook: null,
  notifyEmail: true,
  notifyGotify: true,
  notifyWebhook: false,
  zipStreamMaxBytes: 800 * 1024 * 1024
};

const SECRET_PATHS: [keyof Settings, string][] = [['smtp', 'pass'], ['gotify', 'token'], ['webhook', 'secret']];

export function getSettings(): Settings {
  const rows = db.select().from(schema.settings).all();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = (r.value as { v: unknown }).v;
  for (const [k, field] of SECRET_PATHS) {
    const obj = merged[k] as Record<string, string> | null;
    if (obj && typeof obj[field] === 'string') obj[field] = open(obj[field]);
  }
  return merged as unknown as Settings;
}

export function updateSettings(patch: Partial<Settings>): void {
  const now = nowIso();
  for (const [k, v] of Object.entries(patch)) {
    let value: unknown = v;
    const secret = SECRET_PATHS.find(([key]) => key === k);
    if (secret && value && typeof value === 'object') {
      const obj = { ...(value as Record<string, unknown>) };
      const field = secret[1];
      if (typeof obj[field] === 'string' && obj[field] && !(obj[field] as string).startsWith('enc:')) obj[field] = seal(obj[field] as string);
      value = obj;
    }
    const stored = { v: value } as never;
    db.insert(schema.settings).values({ key: k, value: stored, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: stored, updatedAt: now } }).run();
  }
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return (row ? ((row.value as { v: Settings[K] }).v) : DEFAULT_SETTINGS[key]);
}
