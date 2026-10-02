// Isolated real-browser rehearsal; synthetic photos only, no configured instance.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';

const scratch=await mkdtemp(path.join(tmpdir(),'gatherframe-scopes-')),dataDir=path.join(scratch,'data');
const artifacts=process.env.SCOPES_ARTIFACTS;
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
  const ids=[],fileIds=[],originals=[];
  for(let n=1;n<=4;n++){
    const id=Number(db.prepare("INSERT INTO photos(gallery_id,stem,display_name,rendition_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?)").run(tray,'frame'+n,'Frame '+n,stamp,stamp).lastInsertRowid);ids.push(id);
    for(const collection of n===4?[tray]:n===1?[a]:n===2?[b]:[a,b])db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(collection,id);
    const dir=path.join(dataDir,`derivatives/${project}/${id}`);await mkdir(dir,{recursive:true});
    const svg=`<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="600" fill="${['#b8c9be','#e4c8af','#afc2d3','#dbc0ce'][n-1]}"/><circle cx="${150+n*95}" cy="260" r="110" fill="#f9f5ec"/><path d="M0 560L260 330L500 540L740 350L900 550V600H0Z" fill="#40574c"/><text x="45" y="75" font-size="36" fill="#243c33">Synthetic scene ${n}</text></svg>`;
    const bytes=await sharp(Buffer.from(svg)).webp().toBuffer();
    const original=await sharp(Buffer.from(svg)).jpeg().toBuffer(),rel=`originals/${project}/${id}/print.jpg`;
    await mkdir(path.dirname(path.join(dataDir,rel)),{recursive:true});await writeFile(path.join(dataDir,rel),original);originals.push(original);
    fileIds.push(Number(db.prepare("INSERT INTO photo_files(photo_id,role,original_filename,ext,mime,bytes,sha256,storage_path,created_at) VALUES(?,'print',?,'jpg','image/jpeg',?,?,?,?)").run(id,`private-${n}.jpg`,original.length,createHash('sha256').update(original).digest('hex'),rel,stamp).lastInsertRowid));

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


  const accessPath=projectPath+'/access';
  assert.equal((await guest.request.post(base+accessPath+'?/create',{headers:{origin:base,accept:'text/html'},form:{label:'Unauthorized',collections:'1'}})).status(),401);
  db.prepare('UPDATE galleries SET public_title=? WHERE id=?').run('Family A',a);db.prepare('UPDATE galleries SET public_title=? WHERE id=?').run('Family B',b);
  const tagId=Number(db.prepare("INSERT INTO tags(event_id,public_id,name,shared,created_at) VALUES(?,'b-only','B-only tag',1,?)").run(project,stamp).lastInsertRowid);
  db.prepare('INSERT INTO photo_tags(photo_id,tag_id) VALUES(?,?)').run(ids[1],tagId);
  const api=async(token,collection='a')=>guest.request.get(`${base}/g/${token}/api/photos?g=${collection}`);
  const jsonPost=async(token,endpoint,data)=>guest.request.post(`${base}/g/${token}/api/${endpoint}`,{headers:{origin:base,'user-agent':'Gatherframe synthetic visitor'},data});
  const broad=await (await api(slug)).json(),broadMedia=broad.photos[0].urls.preview;
  await page.goto(base+accessPath,{waitUntil:'networkidle'});
  async function invitation(label,collection,downloads){
    await page.getByLabel('Private recipient label',{exact:true}).fill(label);
    await page.locator(`input[name=collections][value="${collection}"]`).check();
    if(downloads)await page.getByLabel('Allow project-enabled original/version downloads',{exact:true}).check();
    await page.getByRole('button',{name:'Create invitation',exact:true}).click();
    await expect(page.getByLabel('New invitation link',{exact:true})).toBeVisible();
    const url=await page.getByLabel('New invitation link',{exact:true}).inputValue();
    await page.reload({waitUntil:'networkidle'});return url.split('/').at(-1);
  }
  const tokenA=await invitation('Recipient A',a,true),tokenB=await invitation('Recipient B',b,false);
  const grantA=db.prepare("SELECT id FROM guest_grants WHERE label='Recipient A'").get().id;
  assert.notEqual(db.prepare('SELECT token_hash FROM guest_grants WHERE id=?').get(grantA).token_hash,tokenA);
  await page.getByLabel('Only allow scoped invitations',{exact:true}).check();await page.getByRole('button',{name:'Save access mode',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT scoped_sharing_only FROM events WHERE id=?').get(project).scoped_sharing_only).toBe(1);
  assert.equal((await api(slug)).status(),404);assert.equal((await guest.request.get(base+broadMedia,{headers:{'if-none-match':'*'}})).status(),403);
  ok('Owner creates hashed invitations and explicitly disables broad links and previously issued broad media');

  await publicPage.goto(`${base}/g/${tokenA}`,{waitUntil:'networkidle'});
  await expect(publicPage.getByRole('heading',{name:'Family A',exact:true})).toBeVisible();
  assert.doesNotMatch(await publicPage.content(),/Family B|B-only tag|SECRET household|PRIVATE selects|Recipient A/);
  const aData=await (await api(tokenA)).json();assert.deepEqual(aData.photos.map(p=>p.id),[ids[0],ids[2]]);
  assert.equal((await api(tokenA,'b')).status(),404);assert.equal((await guest.request.get(`${base}/g/${tokenA}/c/b`)).status(),404);
  assert.equal((await guest.request.get(`${base}/g/${tokenA}/p/${ids[1]}`)).status(),404);
  assert.equal((await guest.request.get(`${base}/g/${tokenA}/browse?tags=b-only`)).status(),404);
  assert.equal((await guest.request.get(`${base}/g/${tokenA}/t/b-only`)).status(),404);
  const shareLink=await guest.request.get(`${base}/g/${tokenA}/p/${ids[2]}`,{maxRedirects:0});assert.match(shareLink.headers().location,/\/c\/a\?/);
  await publicPage.goto(`${base}/g/${tokenB}`,{waitUntil:'networkidle'});assert.doesNotMatch(await publicPage.content(),/Family A|SECRET household|PRIVATE selects/);
  assert.equal((await api(tokenB,'a')).status(),404);
  const bData=await (await api(tokenB,'b')).json();assert.deepEqual(bData.photos.map(p=>p.id),[ids[1],ids[2]]);assert.ok(bData.photos.every(p=>p.files.length===0));
  ok('Same-device invitations stay separate across HTML, APIs, shared-photo redirects, tags, counts and private labels');

  assert.equal((await guest.request.get(`${base}/g/${tokenA}/file/${fileIds[1]}`)).status(),404);
  assert.equal((await guest.request.get(`${base}/g/${tokenB}/file/${fileIds[1]}`)).status(),403);
  const allowedFile=await guest.request.get(`${base}/g/${tokenA}/file/${fileIds[0]}`);assert.equal(allowedFile.status(),200);assert.deepEqual(await allowedFile.body(),originals[0]);
  assert.equal((await jsonPost(tokenA,'zip',{photoIds:[ids[1]],roles:['print']})).status(),409);
  assert.equal((await jsonPost(tokenB,'zip',{photoIds:[ids[1]],roles:['print']})).status(),403);
  const zip=await jsonPost(tokenA,'zip',{photoIds:[ids[0],ids[2]],roles:['print']});assert.equal(zip.status(),200);const zipUrl=(await zip.json()).url;
  assert.equal((await guest.request.get(base+zipUrl.replace(tokenA,tokenB))).status(),403);
  const zipBytes=await guest.request.get(base+zipUrl);assert.equal(zipBytes.status(),200);assert.equal((await zipBytes.body()).subarray(0,2).toString(),'PK');
  const badCart=[{key:'scope-cart',productId:1,quantity:1,sheets:[{templateCode:'x',cells:[{cellIndex:0,photoId:ids[1],rotated:false}]}]}];
  const quote=await jsonPost(tokenA,'quote',{cart:badCart});assert.equal(quote.status(),404);
  const orderAttempt=await jsonPost(tokenA,'orders',{cart:badCart,idempotencyKey:'out-of-scope-order',customer:{name:'Fixture',email:'fixture@example.invalid'}});assert.equal(orderAttempt.status(),404);
  const activity=await jsonPost(tokenA,'activity',{id:'00000000-0000-4000-8000-000000000001',kind:'photo_view',photoId:ids[1]});assert.equal(activity.status(),404);
  ok('Original bytes and ZIPs enforce scope/download policy; another invitation cannot redeem a ZIP or record hidden-photo activity');

  await page.getByLabel('Selection title for Recipient A',{exact:true}).fill('Choose final images');
  await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Recipient A',exact:true})}).getByRole('button',{name:'Create selection round',exact:true}).click();
  await expect.poll(()=>db.prepare('SELECT count(*) n FROM proof_rounds').get().n).toBe(1);
  const round=db.prepare('SELECT id FROM proof_rounds').get().id,proofUrl=`${base}/g/${tokenA}/proofs/${round}`;
  assert.equal((await guest.request.get(`${base}/g/${tokenB}/proofs/${round}`)).status(),404);
  await publicPage.goto(proofUrl,{waitUntil:'networkidle'});await expect(publicPage.getByRole('heading',{name:'Choose final images',exact:true})).toBeVisible();
  await expect(publicPage.locator('input[name=photoIds]')).toHaveCount(2);
  await publicPage.getByLabel(`Photo ${ids[0]}`,{exact:true}).check();await publicPage.getByLabel(`Note for Photo ${ids[0]}`,{exact:true}).fill('Please keep warm tones');
  await publicPage.getByLabel('Message to your photographer',{exact:true}).fill('My first selection');await publicPage.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(publicPage.getByRole('status')).toHaveText('Draft saved.');await publicPage.reload({waitUntil:'networkidle'});
  await expect(publicPage.getByLabel(`Photo ${ids[0]}`,{exact:true})).toBeChecked();await expect(publicPage.getByLabel(`Note for Photo ${ids[0]}`,{exact:true})).toHaveValue('Please keep warm tones');
  const stale=await guest.request.post(proofUrl,{headers:{origin:base,accept:'text/html'},form:{version:'0',photoIds:String(ids[0]),intent:'draft'}});assert.equal(stale.status(),409);assert.equal(db.prepare('SELECT version FROM proof_rounds WHERE id=?').get(round).version,1);
  const crossOrigin=await guest.request.post(proofUrl,{headers:{origin:'https://untrusted.example.invalid',accept:'text/html'},form:{version:'1',photoIds:String(ids[0]),intent:'submit'}});assert.equal(crossOrigin.status(),403);
  const wrongRecipient=await guest.request.post(proofUrl.replace(tokenA,tokenB),{headers:{origin:base,accept:'text/html'},form:{version:'1',photoIds:String(ids[2]),intent:'submit'}});assert.ok([404,409].includes(wrongRecipient.status()));
  assert.equal(db.prepare('SELECT count(*) n FROM proof_submissions').get().n,0);

  await publicPage.getByRole('button',{name:'Submit selection',exact:true}).click();await expect(publicPage.getByText('This round is locked. Your photographer can reopen it for revisions.',{exact:true})).toBeVisible();
  assert.equal(db.prepare('SELECT count(*) n FROM proof_submissions').get().n,1);
  const submitted=db.prepare('SELECT * FROM proof_rounds WHERE id=?').get(round);assert.equal(submitted.status,'submitted');assert.deepEqual(JSON.parse(submitted.selection),[ids[0]]);
  await shot('submitted-proof',publicPage);
  ok('Recipient draft survives reload, explicit submission locks it, and one immutable submission is stored');

  await page.goto(`${base}${projectPath}/proofs/${round}`,{waitUntil:'networkidle'});
  await expect(page.getByText('Please keep warm tones',{exact:true})).toBeVisible();await page.getByLabel('Feedback for recipient',{exact:true}).fill('Please include the shared portrait too');
  await page.getByRole('button',{name:'Reopen for changes',exact:true}).click();await expect.poll(()=>db.prepare('SELECT status FROM proof_rounds WHERE id=?').get(round).status).toBe('open');
  await publicPage.reload({waitUntil:'networkidle'});await expect(publicPage.getByText('Please include the shared portrait too',{exact:true})).toBeVisible();
  await publicPage.getByLabel(`Photo ${ids[2]}`,{exact:true}).check();await publicPage.getByRole('button',{name:'Submit selection',exact:true}).click();await expect.poll(()=>db.prepare('SELECT count(*) n FROM proof_submissions').get().n).toBe(2);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Accept selection',exact:true}).click();await expect.poll(()=>db.prepare('SELECT status FROM proof_rounds WHERE id=?').get(round).status).toBe('accepted');
  assert.deepEqual(JSON.parse(db.prepare('SELECT selection FROM proof_submissions ORDER BY id LIMIT 1').get().selection),[ids[0]]);
  await page.setViewportSize({width:390,height:844});await publicPage.setViewportSize({width:390,height:844});await publicPage.reload({waitUntil:'networkidle'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('proof-mobile',publicPage);await shot('proof-review-mobile');
  ok('Photographer reopens with feedback and accepts a revised selection; history survives and mobile views fit');

  await page.goto(base+accessPath,{waitUntil:'networkidle'});
  const recipient=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Recipient A',exact:true})});
  await recipient.getByRole('button',{name:'Rotate link',exact:true}).click();await expect(page.getByLabel('New invitation link',{exact:true})).toBeVisible();const tokenNew=(await page.getByLabel('New invitation link',{exact:true}).inputValue()).split('/').at(-1);
  assert.notEqual(tokenNew,tokenA);assert.equal((await api(tokenA)).status(),404);assert.equal((await guest.request.get(base+aData.photos[0].urls.preview,{headers:{'if-none-match':'*'}})).status(),403);
  assert.equal((await guest.request.get(base+zipUrl)).status(),404);assert.equal((await guest.request.get(base+zipUrl.replace(tokenA,tokenNew))).status(),403);
  const fresh=await (await api(tokenNew)).json();assert.equal((await guest.request.get(base+fresh.photos[0].urls.preview)).status(),200);
  db.prepare('DELETE FROM gallery_photos WHERE gallery_id=? AND photo_id=?').run(a,ids[0]);assert.equal((await guest.request.get(base+fresh.photos[0].urls.preview,{headers:{'if-none-match':'*'}})).status(),403);
  assert.equal((await guest.request.get(`${base}/g/${tokenNew}/file/${fileIds[0]}`)).status(),404);
  ok('Rotation invalidates old gallery/media/ZIP capabilities, and membership removal immediately revokes saved media and files');

  const {hash}=await import('@node-rs/argon2');db.prepare('UPDATE events SET password_hash=? WHERE id=?').run(await hash('fixture-password'),project);
  assert.equal((await api(tokenNew)).status(),401);await publicPage.goto(`${base}/g/${tokenNew}`,{waitUntil:'networkidle'});await publicPage.getByLabel('Gallery password',{exact:true}).fill('fixture-password');await publicPage.getByRole('button',{name:'Open gallery',exact:true}).click();await expect(publicPage.getByRole('heading',{name:'Family A',exact:true})).toBeVisible();
  db.prepare('UPDATE events SET expires_at=? WHERE id=?').run('2000-01-01',project);assert.equal((await api(tokenNew)).status(),410);db.prepare('UPDATE events SET expires_at=NULL,password_hash=NULL WHERE id=?').run(project);
  await recipient.getByRole('button',{name:'Revoke invitation',exact:true}).click();await expect.poll(()=>db.prepare('SELECT revoked_at FROM guest_grants WHERE id=?').get(grantA).revoked_at).toBeTruthy();
  assert.equal((await api(tokenNew)).status(),404);assert.equal((await guest.request.get(`${base}/g/${tokenNew}/proofs/${round}`)).status(),404);
  assert.equal(db.prepare('SELECT count(*) n FROM proof_submissions').get().n,2);assert.deepEqual(db.prepare('SELECT * FROM photos ORDER BY id').all(),originalPhotos);
  const grantB=db.prepare("SELECT id FROM guest_grants WHERE label='Recipient B'").get().id;db.prepare('UPDATE guest_grants SET expires_at=? WHERE id=?').run('2000-01-01',grantB);assert.equal((await api(tokenB,'b')).status(),404);
  ok('Password, project expiry, invitation expiry and revocation apply to scoped galleries and proofs without deleting submission history or photos');
  assert.deepEqual(errors,[]);ok('No browser runtime errors');
  const report={passed:checks.length,checks};console.log(JSON.stringify(report));if(artifacts)await writeFile(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
} catch(error){console.error(logs);if(artifacts&&page)await shot('failure').catch(()=>{});throw error;}
finally{await browser?.close();db?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(timer);}await rm(scratch,{recursive:true,force:true});}
