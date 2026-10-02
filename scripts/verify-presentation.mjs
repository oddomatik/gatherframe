// Isolated real-browser rehearsal; synthetic photos only, no configured instance.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';

const scratch=await mkdtemp(path.join(tmpdir(),'gatherframe-presentation-')),dataDir=path.join(scratch,'data');
const artifacts=process.env.PRESENTATION_ARTIFACTS;
if(artifacts)await mkdir(artifacts,{recursive:true});
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',DATA_DIR:dataDir,APP_SECRET:randomBytes(32).toString('hex'),SETUP_ENABLED:'1',DEMO_MODE:'0',HOST:'127.0.0.1',PORT:String(port),ORIGIN:base,PUBLIC_ORIGIN:base,B2_KEY_ID:'',B2_APPLICATION_KEY:''},stdio:['ignore','pipe','pipe']});
let logs='',browser,db,page;for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs=(logs+b).slice(-15000));
const errors=[],checks=[];const ok=name=>{checks.push(name);console.log('PASS '+name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function post(url,fields,cookie){return fetch(base+url,{method:'POST',redirect:'manual',headers:{origin:base,accept:'text/html',...(cookie?{cookie}:{})},body:new URLSearchParams(fields)});}
async function shot(name,target=page){if(artifacts){await expect(target.locator('div[aria-live=polite] > div')).toHaveCount(0);await target.evaluate(()=>window.scrollTo(0,0));await target.screenshot({path:path.join(artifacts,name+'.png'),fullPage:false});}}
try {
  for(let i=0;i<200;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(i===199||child.exitCode!==null)throw Error(logs);await delay(100);}
  let r=await post('/setup',{email:'presentation@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Example Studio'});
  assert.equal(r.status,303);const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await post('/admin?/create',{name:'A day together'},cookie);assert.equal(r.status,303);
  const projectPath=r.headers.get('location'),project=Number(projectPath.split('/').at(-1));
  db=new Database(path.join(dataDir,'db/app.sqlite'));db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
  const stamp=new Date().toISOString(),slug=db.prepare('SELECT slug FROM events WHERE id=?').get(project).slug;
  const addCollection=(publicId,name,isIntake=0)=>Number(db.prepare('INSERT INTO galleries(event_id,public_id,name,is_intake,sort_order,created_at) VALUES(?,?,?,?,?,?)').run(project,publicId,name,isIntake,isIntake?0:publicId==='a'?1:2,stamp).lastInsertRowid);
  const tray=addCollection('tray','To sort',1),a=addCollection('a','SECRET household'),b=addCollection('b','PRIVATE selects');
  const ids=[];
  for(let n=1;n<=4;n++){
    const id=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(tray,'frame'+n,'Frame '+n,stamp,stamp).lastInsertRowid);ids.push(id);
    for(const collection of n===4?[tray]:n===2?[a]:[a,b])db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,id);
    const dir=path.join(dataDir,`derivatives/${project}/${id}`);await mkdir(dir,{recursive:true});
    const svg=`<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="600" fill="${['#b8c9be','#e4c8af','#afc2d3','#dbc0ce'][n-1]}"/><circle cx="${150+n*95}" cy="260" r="110" fill="#f9f5ec"/><path d="M0 560L260 330L500 540L740 350L900 550V600H0Z" fill="#40574c"/><text x="45" y="75" font-size="36" fill="#243c33">Synthetic scene ${n}</text></svg>`;
    const bytes=await sharp(Buffer.from(svg)).webp().toBuffer();
    for(const kind of ['thumb','preview','web','cover640','cover960','cover1440'])await writeFile(path.join(dir,kind+'.webp'),bytes);
  }
  db.prepare('UPDATE events SET is_published=1,share_photo_id=? WHERE id=?').run(ids[0],project);
  const originalPhotos=db.prepare('SELECT * FROM photos ORDER BY id').all();
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const owner=await browser.newContext({viewport:{width:1440,height:1000}}),guest=await browser.newContext({viewport:{width:1280,height:900}});
  for(const context of [owner,guest])await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await owner.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
  page=await owner.newPage();const publicPage=await guest.newPage();for(const p of [page,publicPage])p.on('pageerror',e=>errors.push(e.message));

  await publicPage.goto(`${base}/g/${slug}`,{waitUntil:'networkidle'});
  await expect(publicPage.getByRole('heading',{name:'Find your photos',exact:true})).toBeVisible();
  await expect(publicPage.locator('.parent-collection-grid > li')).toHaveCount(2);
  assert.doesNotMatch(await publicPage.content(),/SECRET household|PRIVATE selects|Synthetic scene 4/);
  await shot('directory-desktop',publicPage);ok('Existing projects keep anonymous collection-directory presentation');

  await page.goto(base+projectPath+'#project-presentation',{waitUntil:'networkidle'});
  await expect(page.getByRole('heading',{name:'Gallery presentation',exact:true})).toBeVisible();
  await page.getByLabel('Edit collection',{exact:true}).selectOption(String(a));
  await page.getByLabel('Public title',{exact:false}).fill('The ceremony');
  await page.getByLabel('Public description',{exact:false}).fill('A quiet moment <script>not executable</script>');
  await page.getByLabel('Gallery layout',{exact:true}).selectOption('sections');
  await page.getByRole('button',{name:'Save gallery layout',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT gallery_layout FROM events WHERE id=?').get(project).gallery_layout).toBe('sections');
  await expect(page.getByLabel('Public title',{exact:false})).toHaveValue('The ceremony');
  await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:/^Presentation/}).click();
  await expect(page.getByLabel('Public title',{exact:false})).toHaveValue('The ceremony');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByLabel('Edit collection',{exact:true}).selectOption(String(b));
  await expect(page.getByLabel('Edit collection',{exact:true})).toHaveValue(String(a));
  await expect(page.getByLabel('Public title',{exact:false})).toHaveValue('The ceremony');
  ok('Unrelated saves and tab switches preserve drafts; collection switches warn before discarding');

  await page.getByRole('button',{name:'Move Frame 3 earlier',exact:true}).click();
  await page.getByRole('button',{name:'Move Frame 3 earlier',exact:true}).click();
  await page.getByRole('button',{name:'Save collection presentation',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT public_title FROM galleries WHERE id=?').get(a).public_title).toBe('The ceremony');
  const api=await guest.request.get(`${base}/g/${slug}/api/photos?g=a`),payload=await api.json();
  assert.deepEqual(payload.photos.map(p=>p.id),[ids[2],ids[0],ids[1]]);assert.equal(payload.gallery.name,'The ceremony');
  assert.doesNotMatch(JSON.stringify(payload),/SECRET household|PRIVATE selects/);
  assert.deepEqual((await (await guest.request.get(`${base}/g/${slug}/api/photos?g=b`)).json()).photos.map(p=>p.id),[ids[0],ids[2]]);
  await shot('presentation-desktop');ok('Explicit public text and per-collection photo sequence save through the studio without changing other collections');

  await page.getByLabel('Gallery layout',{exact:true}).selectOption('sections');
  await page.getByRole('button',{name:'Save gallery layout',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT gallery_layout FROM events WHERE id=?').get(project).gallery_layout).toBe('sections');
  await publicPage.reload({waitUntil:'networkidle'});
  await expect(publicPage.getByRole('navigation',{name:'Gallery sections'})).toBeVisible();
  await expect(publicPage.getByRole('heading',{name:'The ceremony',exact:true})).toBeVisible();
  await expect(publicPage.getByText('A quiet moment <script>not executable</script>',{exact:true})).toBeVisible();
  assert.doesNotMatch(await publicPage.content(),/SECRET household|PRIVATE selects|<script>not executable/);
  await shot('sections-desktop',publicPage);ok('Story layout displays public chapters and escapes descriptions');

  await page.getByText('Collection display order',{exact:true}).click();
  await page.getByRole('button',{name:'Move PRIVATE selects earlier',exact:true}).click();
  await page.getByRole('button',{name:'Save collection order',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=0 ORDER BY sort_order,id').all(project).map(g=>g.id)).toEqual([b,a]);
  await publicPage.reload({waitUntil:'networkidle'});
  assert.deepEqual(await publicPage.locator('nav[aria-label="Gallery sections"] a').allTextContents(),['Collection 01','The ceremony','Browse all photos →']);
  ok('Guest chapter order is independent from the name-sorted studio sidebar');

  await page.getByLabel('Gallery layout',{exact:true}).selectOption('simple');await page.getByRole('button',{name:'Save gallery layout',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT gallery_layout FROM events WHERE id=?').get(project).gallery_layout).toBe('simple');
  await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.getByLabel('Accept print orders',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save project settings',exact:true}).click();await expect(page.getByRole('tab',{name:'Sales',exact:true})).toHaveCount(0);
  await publicPage.reload({waitUntil:'networkidle'});
  await expect(publicPage.getByRole('heading',{name:'A day together',exact:true})).toBeVisible();
  await expect(publicPage.getByRole('button',{name:/^Download photo \d+$/})).toHaveCount(3);
  await expect(publicPage.getByRole('link',{name:/Order.*prints/})).toHaveCount(0);
  await expect(publicPage.getByRole('heading',{name:'Find your photos'})).toHaveCount(0);
  assert.deepEqual(db.prepare('SELECT * FROM photos ORDER BY id').all(),originalPhotos);
  await shot('simple-desktop',publicPage);ok('Simple layout opens directly to unique filed photos; sales-off hides commerce without changing photos or intake');

  await page.goto(base+'/admin',{waitUntil:'networkidle'});await page.getByLabel('Name',{exact:true}).fill('Portrait session');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Portrait session',exact:true})).toBeVisible();
  const fresh=db.prepare("SELECT * FROM events WHERE name='Portrait session'").get();assert.equal(fresh.gallery_layout,'simple');assert.equal(fresh.ordering_enabled,0);assert.equal(fresh.is_published,0);
  await expect(page.getByRole('tab',{name:'Sales',exact:true})).toHaveCount(0);
  ok('New project UI defaults to a private simple gallery with optional print orders');

  await page.goto(base+projectPath+'#project-presentation',{waitUntil:'networkidle'});
  await page.setViewportSize({width:390,height:844});await publicPage.setViewportSize({width:390,height:844});
  for(const layout of ['directory','simple','sections']){
    await page.getByLabel('Gallery layout',{exact:true}).selectOption(layout);await page.getByRole('button',{name:'Save gallery layout',exact:true}).click();
    await expect.poll(()=>db.prepare('SELECT gallery_layout FROM events WHERE id=?').get(project).gallery_layout).toBe(layout);
    await publicPage.reload({waitUntil:'networkidle'});assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(layout+'-mobile',publicPage);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('presentation-mobile');
  ok('All guest layouts and presentation controls fit a 390px viewport');

  await page.getByRole('tab',{name:'Sharing',exact:true}).click();await page.getByText('Password & link settings',{exact:true}).click();
  await page.locator('input[name=password]').fill('fixture-pass');await page.getByRole('button',{name:'Set password',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT password_hash FROM events WHERE id=?').get(project).password_hash).toBeTruthy();
  await publicPage.reload({waitUntil:'networkidle'});await expect(publicPage.getByLabel('Gallery password',{exact:true})).toBeVisible();
  assert.doesNotMatch(await publicPage.content(),/The ceremony|not executable|SECRET household/);
  assert.equal((await guest.request.get(`${base}/g/${slug}/api/photos?g=a`)).status(),401);
  db.prepare('UPDATE events SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',project);
  await publicPage.reload({waitUntil:'networkidle'});await expect(publicPage.getByRole('heading',{name:'This gallery has closed'})).toBeVisible();
  ok('Password and expiry still gate every layout and public collection API');
  assert.deepEqual(errors,[]);ok('No browser runtime errors');
  const report={passed:checks.length,checks};console.log(JSON.stringify(report));if(artifacts)await writeFile(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
} catch(error){console.error(logs);if(artifacts&&page)await shot('failure').catch(()=>{});throw error;}
finally{await browser?.close();db?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(timer);}await rm(scratch,{recursive:true,force:true});}
