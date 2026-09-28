import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'test-photos';
const kids = ['Emma R', 'Liam K', 'Ava M'];
const palettes = [['#f59e0b', '#7c2d12'], ['#0ea5e9', '#1e3a8a'], ['#22c55e', '#14532d'], ['#ec4899', '#831843']];

function svg(w, h, name, pose, [a, b]) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w / 2}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.18}" fill="#fde68a"/>
  <rect x="${w * 0.3}" y="${h * 0.58}" width="${w * 0.4}" height="${h * 0.35}" rx="${w * 0.08}" fill="#fff7ed"/>
  <text x="50%" y="${h * 0.95}" font-family="sans-serif" font-size="${Math.round(h * 0.05)}" text-anchor="middle" fill="white">${name} · pose ${pose}</text>
</svg>`);
}

for (const kid of kids) {
  const dir = path.join(out, kid);
  mkdirSync(dir, { recursive: true });
  for (let pose = 1; pose <= 4; pose++) {
    const stem = `${kid.split(' ')[0].toUpperCase()}_${String(pose).padStart(4, '0')}`;
    const portrait = pose % 2 === 1;
    const [W, H] = portrait ? [4000, 6000] : [6000, 4000];
    const base = sharp(svg(W, H, kid, pose, palettes[pose - 1]));
    await base.clone().jpeg({ quality: 90 }).toFile(path.join(dir, `${stem}-print.jpg`));
    await base.clone().resize({ width: portrait ? 800 : 1200 }).jpeg({ quality: 82 }).toFile(path.join(dir, `${stem}-social.jpg`));
    // A TIFF stands in for the camera RAW in tests (same TIFF magic bytes; real RAW previews need a real camera file).
    await base.clone().resize({ width: 1600 }).tiff({ compression: 'jpeg', quality: 80 }).toFile(path.join(dir, `${stem}.nef`));
    process.stdout.write('.');
  }
}
console.log(`\nwrote test photos to ${out}`);
