import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { showcaseFiles, validateShowcaseAssets } from './showcase-assets.mjs';

function fixture(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'showcase-policy-'));
  try {
    for (const file of [...showcaseFiles, 'scripts/fixtures/showcase/manifest.json', 'docs/screenshots/manifest.json']) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); copyFileSync(file, path.join(dir, file));
    }
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function amend(dir, change) {
  const file = path.join(dir, 'docs/screenshots/manifest.json');
  const value = JSON.parse(readFileSync(file, 'utf8')); change(value.assets); writeFileSync(file, JSON.stringify(value));
}
test('only the reviewed synthetic assets are exempt from the binary ban', () => {
  const result = validateShowcaseAssets(); assert.deepEqual(result.errors, []);
  assert.equal(result.allowed.size, 14); assert.equal(result.allowed.has('docs/screenshots/customer.webp'), false);
});
test('modified bytes, missing entries and mismatched directories fail closed', () => fixture(dir => {
  writeFileSync(path.join(dir, showcaseFiles[0]), 'changed');
  amend(dir, assets => { assets[0].file = showcaseFiles[0]; assets.pop(); });
  const errors = validateShowcaseAssets(dir).errors.join('\n');
  assert.match(errors, /not a WebP/); assert.match(errors, /unexpected or duplicate/); assert.match(errors, /missing showcase/);
}));
test('path traversal and duplicate manifest entries cannot add exemptions', () => fixture(dir => {
  amend(dir, assets => { assets.push({ ...assets[0], file: '../../private.webp' }, assets[0]); });
  assert.match(validateShowcaseAssets(dir).errors.join('\n'), /unexpected or duplicate/);
}));
test('symlinks, oversized images and changed fingerprints are rejected', () => fixture(dir => {
  const first = path.join(dir, showcaseFiles[0]); rmSync(first); symlinkSync(path.resolve(showcaseFiles[0]), first);
  writeFileSync(path.join(dir, showcaseFiles[1]), Buffer.alloc(1024 * 1024 + 1));
  amend(dir, assets => { assets[0].sha256 = '0'.repeat(64); });
  const errors = validateShowcaseAssets(dir).errors.join('\n');
  assert.match(errors, /not a regular file/); assert.match(errors, /exceeds 1 MiB/); assert.match(errors, /fingerprint changed/);
}));
