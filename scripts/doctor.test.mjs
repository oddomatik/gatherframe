import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { diagnose } from './doctor.mjs';

async function fixture(t, owner = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gatherframe-doctor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const child of ['db','originals','derivatives','tmp','backups']) await mkdir(path.join(dir, child));
  const file = path.join(dir, 'db/app.sqlite');
  const db = new Database(file);
  db.exec('CREATE TABLE admin_users(id INTEGER PRIMARY KEY,email TEXT,password TEXT); CREATE TABLE photos(id INTEGER PRIMARY KEY,private_label TEXT);');
  if (owner) db.prepare('INSERT INTO admin_users VALUES(1,?,?)').run('private-owner@example.invalid','private-hash');
  db.prepare('INSERT INTO photos VALUES(1,?)').run('private client label');db.close();
  return { dir, file, env: { APP_SECRET: 'synthetic-sensitive-secret'.repeat(3), PUBLIC_ORIGIN: 'https://studio.example.invalid', ORIGIN: 'https://studio.example.invalid', DATA_DIR: dir, SETUP_ENABLED: '0', PORT: '3000' } };
}
const byId = (r,id) => r.checks.find(c => c.id === id);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
function goodHttp(url) { return Promise.resolve(new Response(url.endsWith('/healthz') ? '{"ok":true}' : '', { status: url.endsWith('/setup') ? 404 : url.endsWith('/admin') ? 303 : 200 })); }

test('read-only offline diagnosis preserves database bytes and withholds identities/secrets', async t => {
  const f=await fixture(t);const before=hash(await readFile(f.file));
  const r=await diagnose({env:f.env,offline:true,fetcher:()=>{throw Error('must not fetch');}});
  assert.equal(r.ok,true);assert.equal(byId(r,'http').status,'skipped');assert.equal(byId(r,'owner').status,'pass');
  assert.equal(hash(await readFile(f.file)),before);
  assert.doesNotMatch(JSON.stringify(r),/private-owner|private-hash|private client label|synthetic-sensitive-secret/);
  assert.equal(byId(r,'recovery').status,'warn');
});

test('missing database is not created or migrated',async t=>{
  const f=await fixture(t);await rm(f.file);
  const r=await diagnose({env:f.env,offline:true});assert.equal(r.ok,false);assert.equal(byId(r,'database-readable').status,'fail');
  await assert.rejects(stat(f.file),{code:'ENOENT'});
});

test('new owner and enabled setup provide distinct actionable warnings',async t=>{
  const f=await fixture(t,false);const r=await diagnose({env:{...f.env,SETUP_ENABLED:'1'},offline:true});
  assert.equal(byId(r,'owner').status,'warn');assert.match(byId(r,'owner').action,/private/);assert.equal(byId(r,'setup-setting').status,'warn');
});

test('foreign key failures and unavailable space fail without leaking database contents',async t=>{
  const f=await fixture(t);const db=new Database(f.file);db.pragma('foreign_keys=OFF');db.exec('CREATE TABLE x(id INTEGER REFERENCES photos(id));INSERT INTO x VALUES(999)');db.close();
  const r=await diagnose({env:{...f.env,STORAGE_MIN_FREE_BYTES:'999999999999999999999999'},offline:true});
  assert.equal(byId(r,'database').status,'fail');assert.equal(byId(r,'disk-space').status,'fail');assert.equal(r.ok,false);
});

test('local HTTP checks never follow redirects or contact PUBLIC_ORIGIN',async t=>{
  const f=await fixture(t);const seen=[];
  const r=await diagnose({env:f.env,fetcher:(url,options)=>{seen.push(url);assert.equal(options.redirect,'manual');assert.equal(options.headers.cookie,undefined);return goodHttp(url);}});
  assert.equal(r.ok,true);assert.equal(seen.length,3);assert.ok(seen.every(url=>url.startsWith('http://127.0.0.1:3000/')));
});

test('HTTP failures, exception details and response bodies stay private',async t=>{
  const f=await fixture(t);const invalidOrigin=new URL('https://example.invalid/private');invalidOrigin.username='user';invalidOrigin.password='synthetic-token';
  const r=await diagnose({env:{...f.env,PUBLIC_ORIGIN:invalidOrigin.href},fetcher:(url)=>{
    if(url.endsWith('/setup'))throw Error('DO NOT EMIT synthetic-transport-secret');
    return Promise.resolve(new Response('private response containing synthetic-response-secret',{status:500}));
  }});
  assert.equal(r.ok,false);assert.equal(byId(r,'configuration').status,'fail');assert.equal(byId(r,'health').status,'fail');
  assert.doesNotMatch(JSON.stringify(r),/synthetic-token|synthetic-transport-secret|synthetic-response-secret/);
});

test('bad ports never cause network access; health requires the expected JSON',async t=>{
  const f=await fixture(t);let seen=0;
  const r=await diagnose({env:{...f.env,PORT:'3000/secret'},fetcher:()=>{seen++;}});assert.equal(seen,0);assert.equal(byId(r,'http').status,'fail');
  const bad=await diagnose({env:f.env,fetcher:url=>url.endsWith('/healthz')?Promise.resolve(new Response('{"ok":false,"error":"private detail"}')):goodHttp(url)});
  assert.equal(byId(bad,'health').status,'fail');assert.doesNotMatch(JSON.stringify(bad),/private detail/);
});

test('snapshot presence is not claimed as verified recovery and filenames stay private',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.dir,'backups/private-client-name.sqlite'),'not a valid snapshot');
  const r=await diagnose({env:f.env,offline:true});assert.equal(byId(r,'recovery').status,'warn');assert.match(byId(r,'recovery').action,/does not verify/);assert.doesNotMatch(JSON.stringify(r),/private-client-name/);
});

test('CLI provides JSON, meaningful failure/usage exits and no raw parser errors',async t=>{
  const f=await fixture(t);const run=(args,env=f.env)=>spawnSync(process.execPath,['scripts/doctor.mjs',...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
  let r=run(['--json','--offline']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);
  r=run(['--json','--offline'],{...f.env,APP_SECRET:'secret-to-withhold'});assert.equal(r.status,1);assert.doesNotMatch(r.stdout+r.stderr,/secret-to-withhold/);
  r=run(['--unknown=private-cli-value']);assert.equal(r.status,2);assert.doesNotMatch(r.stdout+r.stderr,/private-cli-value/);
});
