// Deliberately narrow exception to the public repository's no-photo policy.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const showcaseFiles = [
  ...['coast-wide', 'coast-detail', 'forest-wide', 'forest-detail', 'meadow-wide', 'meadow-detail'].map(name => `scripts/fixtures/showcase/${name}.webp`),
  ...['gallery-desktop', 'gallery-mobile', 'gallery-story', 'studio-organize', 'proof-selection', 'proof-review', 'print-orders', 'first-delivery'].map(name => `docs/screenshots/${name}.webp`)
];
export function validateShowcaseAssets(root = '.') {
  const allowed = new Set(showcaseFiles), seen = new Set(), errors = [];
  let total = 0;
  for (const manifest of ['scripts/fixtures/showcase/manifest.json', 'docs/screenshots/manifest.json']) {
    let assets;
    try { assets = JSON.parse(readFileSync(path.join(root, manifest), 'utf8')).assets; }
    catch { errors.push(`${manifest}: missing or invalid showcase manifest`); continue; }
    if (!Array.isArray(assets)) { errors.push(`${manifest}: assets must be an array`); continue; }
    const directory = path.dirname(manifest) + '/';
    for (const asset of assets) {
      if (!asset || !allowed.has(asset.file) || !asset.file.startsWith(directory) || seen.has(asset.file)) {
        errors.push(`${manifest}: unexpected or duplicate showcase asset`); continue;
      }
      seen.add(asset.file);
      try {
        const file = path.join(root, asset.file), stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('not a regular file');
        if (stat.size > 1024 * 1024) throw Error('exceeds 1 MiB');
        const bytes = readFileSync(file); total += bytes.length;
        if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw Error('not a WebP container');
        if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('fingerprint changed; review and regenerate manifest');
      } catch (error) { errors.push(`${asset.file}: ${error.message}`); }
    }
  }
  for (const file of allowed) if (!seen.has(file)) errors.push(`${file}: missing showcase manifest entry`);
  if (total > 4 * 1024 * 1024) errors.push('Showcase assets exceed the 4 MiB total budget');
  return { allowed, errors };
}
