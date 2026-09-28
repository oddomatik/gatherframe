import { randomBytes, randomInt } from 'node:crypto';

/** Lowercase base32 without ambiguous glyphs (no 0/o, 1/l/i). 12 chars ~ 60 bits. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomId(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
export function orderSuffix(): string { return randomId(4).toUpperCase(); }
