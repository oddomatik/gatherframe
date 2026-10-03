// Fast publication hygiene, not a replacement for a dedicated secret scanner or human review.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateShowcaseAssets } from './showcase-assets.mjs';
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const { allowed: showcaseAssets, errors } = validateShowcaseAssets();
for (const file of files) {
  if (/^(data|backups|\.state|infrastructure|deploy)\//.test(file) || /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example' || !showcaseAssets.has(file) && /\.(sqlite(?:-wal|-shm)?|db|pem|key|jpe?g|png|webp|cr[23]|nef|arw|dng)$/i.test(file))
    errors.push(`${file}: runtime/private/binary file requires removal or an explicit reviewed policy change`);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) { errors.push(`${file}: symlinks are not allowed in public source`); continue; }
  if (stat.size > 1024 * 1024) { errors.push(`${file}: unexpectedly large source file`); continue; }
  // Fingerprinted synthetic WebPs were validated above; never treat arbitrary images as source.
  if (showcaseAssets.has(file)) continue;
  let text = readFileSync(file, 'utf8');
  // Exact synthetic credentials used by rejection tests; no file-wide suppression.
  const dummyUrls = { 'scripts/runtime-config.test.mjs': 'https://' + 'user:pass@' + 'example.com', 'src/lib/server/blob-store.test.ts': 'https://' + 'PRIVATE-KEY-ID:TOP-SECRET-APPLICATION-KEY@' + '127.0.0.1' };
  if (dummyUrls[file]) text = text.replaceAll(dummyUrls[file], 'https://fixture.invalid');
  const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /AKIA[A-Z0-9]{16}/, /https?:\/\/[^\s/]+:[^\s/]+@/, /\/home\/[a-z][a-z0-9_-]+\//];
  for (const pattern of patterns) if (pattern.test(text)) errors.push(`${file}: potential credential or private workstation reference (content redacted)`);
  if (file.endsWith('.md')) for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const dest = match[1].split('#')[0];
    if (!dest || /^(https?:|mailto:|\/)/.test(dest)) continue;
    if (!existsSync(path.resolve(path.dirname(file), dest))) errors.push(`${file}: broken local link ${dest}`);
  }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if (pkg.name !== lock.name || pkg.version !== lock.version || pkg.license !== lock.packages[''].license) errors.push('Package and lockfile metadata differ');
if (pkg.license !== 'AGPL-3.0-only' || !existsSync('LICENSE')) errors.push('Expected AGPL license missing');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Repository hygiene passed for ${files.length} files.`);
