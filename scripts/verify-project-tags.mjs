// Disposable production-build/browser rehearsal for project tag hierarchies.
// Run after npm run build: node scripts/verify-project-tags.mjs
// Never contacts SSH, live hosts, external services, or production data.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket = net.createServer();
socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(path.join(tmpdir(), 'picture-day-tags-browser-'));
const dataDir = path.join(scratch, 'data');
const artifactDir = process.env.TAG_ARTIFACTS;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, APP_SECRET: randomBytes(32).toString('hex'), SETUP_ENABLED: '1',
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '', browser, db, page, adminPage, cookie = '';
child.stdout.on('data', b => { logs = (logs + b).slice(-16000); });
child.stderr.on('data', b => { logs = (logs + b).slice(-16000); });
const checks = [], pageErrors = [], screenshots = [];
const ok = name => { checks.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const full = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#6699aa' } }).jpeg().toBuffer();
const social = await sharp(full).resize(60, 40).jpeg().toBuffer();
const updated = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#cc9955' } }).jpeg().toBuffer();
const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4" /></rdf:RDF></x:xmpmeta>');
async function request(url, options = {}, authenticated = true) {
  assert.ok(url.startsWith('/') && !url.startsWith('//'));
  return fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options,
    headers: { origin: base, accept: 'text/html', ...(authenticated && cookie ? { cookie } : {}), ...options.headers } });
}
const form = entries => ({ method: 'POST', body: new URLSearchParams(entries) });
async function shot(name, target = page) {
  if (!artifactDir) return;
  const destination = path.join(artifactDir, `${name}.png`);
  await target.screenshot({ path: destination, fullPage: false }); screenshots.push(destination);
}
async function waitReady(ids) {
  for (let i = 0; i < 200; i++) {
    const rows = db.prepare(`SELECT id,rendition_status FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const busy = db.prepare("SELECT count(*) n FROM jobs WHERE type='render_photo' AND status IN ('queued','running')").get().n;
    if (!busy && rows.length === ids.length && rows.every(row => row.rendition_status === 'ready')) return;
    if (rows.some(row => row.rendition_status === 'failed')) throw new Error('Fixture render failed: ' + JSON.stringify(rows));
    await delay(100);
  }
  throw new Error('Timed out preparing synthetic previews');
}
function visibleIds(target) {
  return target.locator('article.photo-card img').evaluateAll(images => images.map(image => Number(new URL(image.src).pathname.split('/')[2])));
}
async function assertVisible(ids) { await expect.poll(() => visibleIds(page)).toEqual(ids); }
try {
 for(let i=0;i<100;i++){try{if((await request('/healthz')).ok)break;}catch{} if(i===99||child.exitCode!==null)throw Error(logs);await delay(100);}
 let r=await request('/setup',form({email:'tags@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Tag rehearsal'}));assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
 r=await request('/admin?/create',form({name:'Flexible shoot'}));assert.equal(r.status,303);const eventPath=r.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));
 await request(eventPath+'/upload');db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');
 const event=db.prepare('select * from events where id=?').get(eventId);const intake=db.prepare('select id from galleries where event_id=? and is_intake=1').get(eventId).id;
 const publicBase=`/g/${event.slug}`;
 assert.equal(db.prepare('select count(*) n from tags').get().n,0);ok('New project has no assumed days or preset groups');
 const tagsUrl=`/admin/api/events/${eventId}/tags`;
 const jsonBody=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 async function tag(body){const result=await request(tagsUrl,jsonBody(body));assert.equal(result.status,200,await result.clone().text());return result.json();}
 async function newTag(name,parentId=null,shared=true){return (await tag({action:'save',name,parentId,shared})).tag;}
 const groups=await newTag('Groups'),one=await newTag('Group 1',groups.id),two=await newTag('Group 2',groups.id),play=await newTag('Playtime'),secret=await newTag('PRIVATE STAFF NOTES',null,false),hiddenChild=await newTag('PRIVATE DESCENDANT',secret.id,true);
 r=await request(tagsUrl,jsonBody({action:'save',name:'Unauthorized',shared:true}),false);assert.equal(r.status,401);
 r=await request(tagsUrl,{...jsonBody({action:'save',name:'Wrong origin'}),headers:{'content-type':'application/json',origin:'https://foreign.invalid'}});assert.equal(r.status,403);ok('Tag edits require owner login and reject cross-origin writes');
 const upload=async(name,bytes,ids=[],role='print')=>request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:name,role,tags:ids.join(',')}),{method:'PUT',body:bytes,headers:{'content-type':'application/octet-stream'}});
 async function add(name,ids){const res=await upload(name+'.jpg',full,ids);assert.equal(res.status,200,await res.clone().text());return(await res.json()).photoId;}
 const a=await add('IMG_2',[one.id]),b=await add('IMG_10',[two.id,play.id]),c=await add('IMG_20',[one.id,two.id]),hidden=await add('INTAKE_30',[one.id,secret.id]);await waitReady([a,b,c,hidden]);
 r=await upload('IMG_2.jpg',social,[two.id],'social');assert.equal(r.status,200);assert.deepEqual(db.prepare('select tag_id from photo_tags where photo_id=?').all(a),[{tag_id:one.id}]);ok('Batch tags apply once to new photos; later file sizes preserve identity and existing tags');
 const organize=`/admin/api/events/${eventId}/organize`;
 const plan={targets:[{kind:'new',key:'tag_test_child_one',label:'PRIVATE CHILD ALPHA',photoIds:[a,c]},{kind:'new',key:'tag_test_child_two',label:'PRIVATE CHILD BETA',photoIds:[b,c]}]};r=await request(organize,jsonBody(plan));assert.equal(r.status,200);r=await request(organize,jsonBody(plan));assert.equal(r.status,200);
 const alpha=db.prepare("select * from galleries where name='PRIVATE CHILD ALPHA'").get();const beta=db.prepare("select * from galleries where name='PRIVATE CHILD BETA'").get();
 assert.equal(db.prepare('select count(*) n from gallery_photos where photo_id=?').get(c).n,2);
 const snapshots=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','admin_users','admin_sessions'].map(t=>[t,db.prepare(`select * from ${t} order by rowid`).all()])));const beforeTags=snapshots();
 await tag({action:'add',photoIds:[a,b],tagIds:[play.id]});await tag({action:'remove',photoIds:[a],tagIds:[play.id]});assert.equal(snapshots(),beforeTags);ok('Tagging is independent of shared child collections, source bytes, account, and photo identity');
 db.prepare('update events set is_published=1 where id=?').run(eventId);
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const adminContext=await browser.newContext({viewport:{width:1280,height:900}}),eq=cookie.indexOf('=');await adminContext.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:base,httpOnly:true,sameSite:'Lax'}]);
 adminPage=await adminContext.newPage();adminPage.on('pageerror',e=>pageErrors.push(e.message));await adminPage.goto(base+eventPath,{waitUntil:'networkidle'});
 await adminPage.locator('#tag-panel > summary').click();
 const panel=adminPage.getByRole('region',{name:'Project tags'});
 await adminPage.getByRole('button',{name:'Select img_2',exact:true}).click();
 await panel.getByRole('button',{name:'+ Create tag',exact:true}).click();await panel.getByRole('textbox',{name:'Tag name',exact:true}).fill('Small adventures');await panel.getByLabel('Show to parents / allow sharing',{exact:true}).check();await panel.getByRole('button',{name:'Create tag',exact:true}).click();
 await expect(panel.getByRole('group',{name:'Tags to apply'}).getByRole('checkbox',{name:'Small adventures',exact:true})).toBeChecked();
 await panel.getByRole('button',{name:'Add tags to selected',exact:true}).click();await expect(adminPage.getByRole('button',{name:'Deselect img_2',exact:true})).toBeVisible();
 const adventures=db.prepare("select * from tags where name='Small adventures'").get();assert.ok(db.prepare('select * from photo_tags where photo_id=? and tag_id=?').get(a,adventures.id));
 await panel.getByRole('button',{name:'Remove tags from selected',exact:true}).click();await expect.poll(()=>db.prepare('select count(*) n from photo_tags where photo_id=? and tag_id=?').get(a,adventures.id).n).toBe(0);ok('Owner creates and applies/removes custom tags in browser while retaining photo selection');
 await panel.getByRole('button',{name:'Edit Groups / Group 1',exact:true}).click();await panel.getByRole('textbox',{name:'Tag name',exact:true}).fill('Morning');await panel.getByRole('button',{name:'Save tag',exact:true}).click();await expect(panel.getByRole('button',{name:'Edit Groups / Morning',exact:true})).toBeVisible();assert.equal(db.prepare('select public_id from tags where id=?').get(one.id).public_id,one.publicId);
 await panel.getByRole('group',{name:'Filter by project tags'}).getByRole('checkbox',{name:/Groups \/ Morning/}).check();await expect(adminPage.getByRole('button',{name:'Select img_10',exact:true})).toHaveCount(0);await expect(adminPage.getByRole('button',{name:'Deselect img_2',exact:true})).toBeVisible();
 await adminPage.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();assert.ok(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('owner-project-tags-mobile',adminPage);ok('Hierarchy rename keeps stable link; owner filtering and 390px layout work');
 const parentContext=await browser.newContext({viewport:{width:1100,height:850}});page=await parentContext.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(base+publicBase+'/t/'+groups.publicId,{waitUntil:'networkidle'});await assertVisible([a,b,c]);assert.ok(!await page.getByText('PRIVATE STAFF NOTES',{exact:true}).count());assert.ok(!(await page.content()).includes('PRIVATE DESCENDANT'));assert.ok(!(await page.content()).includes('PRIVATE CHILD'));ok('Parent branch link aggregates descendants, deduplicates shared photos, and excludes private labels/intake');
 await page.goto(base+publicBase+'/t/'+one.publicId,{waitUntil:'networkidle'});await assertVisible([a,c]);
 await page.getByRole('button',{name:'Favorite photo 1',exact:true}).click();await page.locator('article.photo-card').first().getByRole('checkbox').check();
 const nav=page.getByRole('region',{name:'Browse by tags'});await nav.getByRole('button',{name:'Playtime · 1',exact:true}).click();await assertVisible([a,b,c]);await nav.getByRole('combobox',{name:'Match tags'}).selectOption('all');await assertVisible([]);await expect(page.getByRole('button',{name:'Download selected',exact:true})).toBeVisible();
 await page.reload({waitUntil:'networkidle'});await assertVisible([]);ok('Match-any/match-all links reproduce exact filters on reload; selection survives in-page filtering');
 await page.goto(base+publicBase+'/t/'+one.publicId,{waitUntil:'networkidle'});await page.getByRole('button',{name:/♥ Favorites/}).click();await assertVisible([a]);ok('Favorites remain available through tag filtering and reload');
 await page.getByRole('button',{name:/All photos ·/}).click();await page.getByRole('button',{name:'Download shown photos (2)',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download files ↓',exact:true}).click();const download=await downloadPromise;assert.equal(await download.failure(),null);const downloaded=await download.path();assert.ok(downloaded);const unzip=spawnSync('unzip',['-Z1',downloaded],{encoding:'utf8'});assert.equal(unzip.status,0);assert.equal(unzip.stdout.trim().split('\n').length,2);ok('Filtered download contains exactly the selected branch photos');
 await page.goto(base+publicBase+`/c/${alpha.public_id}?tags=${two.publicId}`,{waitUntil:'networkidle'});await assertVisible([c]);
 await page.goto(base+publicBase+`?tags=${two.publicId}`,{waitUntil:'networkidle'});const covers=await page.locator('ul img').evaluateAll(xs=>xs.map(x=>Number(new URL(x.src).pathname.split('/')[2])));assert.ok(covers.includes(c));assert.ok(!covers.includes(a));ok('Collection-specific tag links and filtered collection covers are accurate');
 const keyUrl=publicBase+'/t/'+one.publicId;await tag({action:'save',id:one.id,name:'Morning',parentId:groups.id,shared:false});r=await request(keyUrl,{},false);assert.equal(r.status,404);await tag({action:'save',id:one.id,name:'Morning',parentId:groups.id,shared:true});
 r=await request(publicBase+'/t/'+hiddenChild.publicId,{},false);assert.equal(r.status,404);r=await request(publicBase+'/browse?tags=nonexistent',{},false);assert.equal(r.status,404);
 db.prepare("update events set password_hash='locked-fixture' where id=?").run(eventId);r=await request(keyUrl,{},false);assert.equal(r.status,200);let html=await r.text();assert.ok(!html.includes('Morning'));assert.ok(!html.includes('PRIVATE'));
 db.prepare('update events set password_hash=null,is_published=0 where id=?').run(eventId);r=await request(keyUrl,{},false);assert.equal(r.status,404);db.prepare('update events set is_published=1 where id=?').run(eventId);ok('Private/unshared, unknown, locked, and unpublished branch links enforce existing access rules');
 await page.setViewportSize({width:390,height:844});await page.goto(base+publicBase+'/t/'+one.publicId,{waitUntil:'networkidle'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('parent-hierarchy-mobile');
 assert.deepEqual(pageErrors,[]);ok('Parent mobile layout and complete browser journey have no JavaScript exceptions');
 console.log(JSON.stringify({passed:checks.length,checks,screenshots},null,2));
} catch(error){if(page&&artifactDir)await shot('failure').catch(()=>{});if(adminPage&&artifactDir)await shot('admin-failure',adminPage).catch(()=>{});console.error(error);console.error(logs);throw error;}
finally{await browser?.close();db?.close();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
