// Real browser + production-build rehearsal, entirely disposable and loopback-only.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const scratch=await mkdtemp(path.join(tmpdir(),'gatherframe-delivery-browser-')), dataDir=path.join(scratch,'data');
const artifacts=process.env.DELIVERY_ARTIFACTS;
if(artifacts) await mkdir(artifacts,{recursive:true});
const socket=net.createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening');
const port=socket.address().port; await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',DATA_DIR:dataDir,APP_SECRET:randomBytes(32).toString('hex'),SETUP_ENABLED:'1',DEMO_MODE:'0',HOST:'127.0.0.1',PORT:String(port),ORIGIN:base,PUBLIC_ORIGIN:base,B2_KEY_ID:'',B2_APPLICATION_KEY:''},stdio:['ignore','pipe','pipe']});
let logs='',browser,db,page;
for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs=(logs+b).slice(-18000));
const checks=[],errors=[]; const ok=name=>{checks.push(name);console.log('PASS '+name);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){if(await predicate())return;await delay(100);}throw Error('Fixture timed out: '+logs);}
async function shot(name){if(artifacts)await page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:false});}
async function post(url,fields,cookie){return fetch(base+url,{method:'POST',redirect:'manual',headers:{origin:base,accept:'text/html',...(cookie?{cookie}:{})},body:new URLSearchParams(fields)});}
async function fixtureFile(relative,bytes){const f=path.join(scratch,'exports',relative);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,bytes);return f;}

try {
  await until(async()=>{if(child.exitCode!==null)throw Error(logs);try{return (await fetch(base+'/healthz')).ok;}catch{return false;}});
  let response=await post('/setup',{email:'versions@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Delivery versions fixture'});
  assert.equal(response.status,303);const cookie=response.headers.get('set-cookie').split(';')[0];
  response=await post('/admin?/create',{name:'Studio delivery rehearsal'},cookie);assert.equal(response.status,303);
  const eventPath=response.headers.get('location'), eventId=Number(eventPath.split('/').at(-1));
  db=new Database(path.join(dataDir,'db/app.sqlite')); db.pragma('busy_timeout=5000');
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath)for(const candidate of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),split=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true,sameSite:'Lax'}]);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+eventPath+'/versions',{waitUntil:'networkidle'});
  await expect(page.getByRole('heading',{name:'Delivery versions',exact:true})).toBeVisible();
  assert.equal(db.prepare("SELECT count(*) n FROM delivery_versions WHERE mode='automatic'").get().n,0);
  const add=page.locator('details').filter({has:page.locator('summary',{hasText:'Add a delivery version'})}).last();
  await add.locator('summary').first().click();
  await add.getByLabel('Version name',{exact:true}).fill('Client proof');
  await add.locator('select[name=access]').selectOption('free');
  await add.locator('select[name=filenameMode]').selectOption('original');
  await add.locator('input[name=folder]').fill('Proofs');
  await add.getByRole('button',{name:'Add version',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Client proof',exact:true})).toBeVisible();
  const custom=db.prepare("SELECT key FROM delivery_versions WHERE event_id=? AND label='Client proof'").get(eventId).key;
  let web=page.getByRole('region',{name:'Web size version',exact:true});
  await web.locator('summary').filter({hasText:'Edit version'}).click();
  await web.locator('select[name=mode]').selectOption('automatic');
  await web.getByLabel('Long edge (pixels)',{exact:true}).fill('640');
  await web.getByRole('button',{name:'Save version',exact:true}).click();
  await expect(web.getByText('Automatic from Full resolution',{exact:true})).toBeVisible();
  ok('Named upload-only version and optional automatic recipe configured through the UI');

  const source=await sharp({create:{width:1600,height:1000,channels:3,background:'#7799aa'}}).jpeg({quality:94}).toBuffer();
  const portrait=await sharp({create:{width:1000,height:1500,channels:3,background:'#aa9977'}}).jpeg().toBuffer();
  const proof=await sharp(source).resize(500).jpeg({quality:90}).toBuffer();
  await fixtureFile('Shoot/full/Frame001.jpg',source);await fixtureFile('Shoot/full/Frame002.jpg',portrait);await fixtureFile('Shoot/Proofs/Frame001.jpg',proof);
  await page.goto(base+eventPath+'/upload',{waitUntil:'networkidle'});
  await page.getByLabel('Choose export root folder',{exact:true}).setInputFiles(path.join(scratch,'exports','Shoot'));
  await expect(page.getByRole('heading',{name:'2 photos · 3 files',exact:true})).toBeVisible();
  await expect(page.locator('input[type=file]').first()).toBeEnabled();
  await page.getByRole('button',{name:'Upload files',exact:true}).click();
  await expect(page.getByText('3 transferred',{exact:true})).toBeVisible({timeout:30000});
  await until(()=>db.prepare("SELECT count(*) n FROM photo_files WHERE origin='generated' AND available=1").get().n===2);
  const photos=db.prepare('SELECT id,stem,gallery_id FROM photos ORDER BY stem').all(),first=photos[0];
  const social=db.prepare("SELECT * FROM photo_files WHERE photo_id=? AND role='social'").get(first.id);
  const authored=db.prepare('SELECT * FROM photo_files WHERE photo_id=? AND role=?').get(first.id,custom);
  assert.equal(authored.sha256,hash(proof));assert.equal(social.width,640);assert.equal(social.height,400);
  assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,2);
  ok('Real folder import matches custom mappings, preserves authored bytes and generates Web copies');

  await page.goto(base+eventPath+'/versions',{waitUntil:'networkidle'});
  web=page.getByRole('region',{name:'Web size version',exact:true});await web.locator('summary').filter({hasText:'Edit version'}).click();
  await web.getByRole('button',{name:'Preview these settings'}).click();
  await expect(web.getByAltText('Generated delivery preview')).toBeVisible({timeout:30000});
  await expect(web.getByText(/640 × 400 px/).first()).toBeVisible();
  await shot('delivery-versions-desktop');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await shot('delivery-versions-mobile');
  ok('Recipe preview works with actual dimensions; settings fit a 390px viewport');

  // Only this disposable fixture is published, never a configured instance.
  db.prepare('UPDATE galleries SET is_intake=0 WHERE id=?').run(first.gallery_id);
  db.prepare('UPDATE events SET is_published=1 WHERE id=?').run(eventId);
  const event=db.prepare('SELECT slug FROM events WHERE id=?').get(eventId), gallery=db.prepare('SELECT public_id FROM galleries WHERE id=?').get(first.gallery_id);
  await until(()=>db.prepare("SELECT count(*) n FROM photos WHERE rendition_status='ready'").get().n===2);
  const guest=await browser.newContext({viewport:{width:390,height:844}}),guestPage=await guest.newPage();guestPage.on('pageerror',e=>errors.push(e.message));
  await guestPage.goto(`${base}/g/${event.slug}/c/${gallery.public_id}`,{waitUntil:'networkidle'});
  await guestPage.getByRole('button',{name:'Download photo 1',exact:true}).click();
  await expect(guestPage.getByText('Client proof',{exact:true})).toBeVisible();
  await expect(guestPage.getByText('Web size',{exact:true})).toBeVisible();
  assert.ok(await guestPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(artifacts)await guestPage.screenshot({path:path.join(artifacts,'delivery-guest-mobile.png'),fullPage:false});
  response=await guest.request.get(`${base}/g/${event.slug}/file/${authored.id}`);
  assert.equal(response.status(),200);assert.equal(hash(await response.body()),hash(proof));assert.match(response.headers()['content-disposition'],/Frame001.jpg/);
  response=await guest.request.post(`${base}/g/${event.slug}/api/zip`,{data:{photoIds:[first.id],roles:['social',custom]}});assert.equal(response.status(),200);
  const download=await response.json();const zip=await guest.request.get(base+download.url);assert.equal(zip.status(),200);assert.ok((await zip.body()).includes(Buffer.from('Frame001.jpg')));
  ok('Mobile guest selector uses custom labels; exact authored files and mixed-version ZIPs download');

  await page.setViewportSize({width:1440,height:1000});await page.goto(base+eventPath+'/upload',{waitUntil:'networkidle'});
  await page.getByText('Add separate folders or files',{exact:true}).click();
  const override=await sharp(source).resize(750).jpeg({quality:95}).toBuffer();
  await page.getByLabel('Choose web size files',{exact:true}).setInputFiles({name:'Frame001.jpg',mimeType:'image/jpeg',buffer:override});
  await expect(page.getByRole('heading',{name:'1 photos · 1 files',exact:true})).toBeVisible();
  await page.getByLabel(/Update existing versions/).check();
  await page.getByRole('button',{name:'Upload files',exact:true}).click();
  await expect(page.getByText('1 transferred',{exact:true})).toBeVisible({timeout:30000});
  assert.equal(db.prepare("SELECT origin FROM photo_files WHERE photo_id=? AND role='social'").get(first.id).origin,'uploaded');
  assert.equal(db.prepare("SELECT sha256 FROM photo_files WHERE photo_id=? AND role='social'").get(first.id).sha256,hash(override));
  ok('Photographer can replace one automatic copy with an exact custom export through the importer');

  if(process.env.DELIVERY_BENCHMARK==='1') {
    const count=24, latencies=[], sources=[];
    for(let n=0;n<count;n++) sources.push(await sharp({create:{width:6000,height:4000,channels:3,background:{r:80+n*3,g:100+n*2,b:120+n}}}).jpeg({quality:92}).toBuffer());
    const start=performance.now();
    let running=true,healthRequests=0,peakRssKiB=0,probeError;
    const probe=(async()=>{while(running){const at=performance.now();assert.equal((await fetch(`${base}/g/${event.slug}/c/${gallery.public_id}`)).status,200);latencies.push(performance.now()-at);healthRequests++;try{const {readFile}=await import('node:fs/promises');const status=await readFile(`/proc/${child.pid}/status`,'utf8');peakRssKiB=Math.max(peakRssKiB,Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0));}catch{}await delay(150);}})().catch(err=>{probeError=err;running=false;});
    try {
    for(let n=0;n<count;n++) {
      const url=`${base}/admin/api/events/${eventId}/upload?gallery=${first.gallery_id}&role=print&filename=Batch${String(n).padStart(3,'0')}.jpg`;
      const r=await fetch(url,{method:'PUT',headers:{cookie,origin:base,'content-type':'image/jpeg'},body:sources[n]});assert.equal(r.status,200,await r.text());
    }
    await until(()=>db.prepare("SELECT count(*) n FROM photos p JOIN photo_files f ON f.photo_id=p.id WHERE p.stem LIKE 'batch%' AND f.role='social' AND f.origin='generated' AND p.rendition_status='ready'").get().n===count,90000);
    } finally { running=false;await probe; }
    if(probeError)throw probeError;latencies.sort((a,b)=>a-b);
    const benchmark={kind:'24 distinct synthetic flat-color JPEGs; HTML gallery requests; not a real-shoot capacity guarantee',photos:count,pixelsPerPhoto:24000000,seconds:Math.round((performance.now()-start)/100)/10,galleryRequests:healthRequests,p95GalleryMs:Math.round(latencies[Math.floor(latencies.length*.95)]),peakObservedServerRssMiB:Math.round(peakRssKiB/1024)};
    console.log(JSON.stringify({benchmark}));if(artifacts)await writeFile(path.join(artifacts,'benchmark.json'),JSON.stringify(benchmark,null,2));
    ok('24 full-resolution synthetic photos generate while the guest gallery remains responsive');
  }
  assert.deepEqual(errors,[]);ok('No browser runtime errors');
  const report={passed:checks.length,checks};console.log(JSON.stringify(report));if(artifacts)await writeFile(path.join(artifacts,'browser-report.json'),JSON.stringify(report,null,2));
} catch(err) { console.error(err);console.error(logs); if(artifacts&&page)await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:false}).catch(()=>{});throw err; }
finally {await browser?.close();db?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timeout);}await rm(scratch,{recursive:true,force:true});}
