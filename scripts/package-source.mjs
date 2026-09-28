// Bundle corresponding source, never runtime data or Git history. tar is required.
import { readdirSync, lstatSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const roots = ['src', 'scripts', 'docs', '.github'];
const files = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'CHANGELOG.md', 'package.json', 'package-lock.json', 'server.js', 'Dockerfile', 'docker-compose.yml', 'Caddyfile',
  'svelte.config.js', 'tsconfig.json', 'vite.config.ts', 'drizzle.config.ts', '.env.example', '.dockerignore', '.gitignore',
  '.editorconfig', '.gitattributes', '.nvmrc', 'static/favicon.svg'];
function walk(dir) {
  for (const item of readdirSync(dir)) {
    const name = `${dir}/${item}`, info = lstatSync(name);
    if (info.isSymbolicLink()) throw Error('Source bundle cannot contain symlinks: ' + name);
    if (info.isDirectory()) walk(name); else files.push(name);
  }
}
for (const root of roots) walk(root);
mkdirSync('static', { recursive: true });
const result = spawnSync('tar', ['-czf', 'static/source.tgz', '--', ...files.sort()], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Packaged ${files.length} source files; data, environment secrets and Git history excluded.`);
