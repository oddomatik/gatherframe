#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--development')) throw Error('Usage: node scripts/init-env.mjs [--development]');
let text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  .replace(/^APP_SECRET=.*$/m, `APP_SECRET=${randomBytes(32).toString('hex')}`);
if (args.includes('--development')) text = text.replaceAll('http://localhost:3000', 'http://localhost:5173').replace(/^SETUP_ENABLED=0$/m, 'SETUP_ENABLED=1');
try {
  writeFileSync('.env', text, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env. Existing configuration is never overwritten.');
} catch (error) {
  if (error.code === 'EEXIST') throw Error('.env already exists; edit it deliberately. Its signing secret must survive upgrades.');
  throw error;
}
