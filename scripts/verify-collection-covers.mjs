// Real browser/HTTP cover workflow, synthetic loopback-only data; never uses the live app.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';

const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base=`http://127.0.0.1:${port}`,scratch=await mkdtemp(path.join(tmpdir(),'picture-day-covers-')),dataDir=path.join(scratch,'data');
const server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dataDir,APP_SECRET:randomBytes(32).toString('hex'),SETUP_ENABLED:'1',HOST:'127.0.0.1',PORT:String(port),ORIGIN:base,PUBLIC_ORIGIN:base,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
let logs='',browser,db,cookie='';
server.stdout.on('data',b=>logs=(logs+b).slice(-10000));server.stderr.on('data',b=>logs=(logs+b).slice(-10000));
const errors=[],checks=[],pass=text=>{checks.push(text);console.log(`PASS ${text}`);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=(url,options={},authenticated=true)=>fetch(base+url,{redirect:'manual',...options,headers:{origin:base,accept:'text/html',...(authenticated?{cookie}:{}),...options.headers},signal:AbortSignal.timeout(15000)});
const form=values=>({method:'POST',body:new URLSearchParams(values)});
const json=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
try {
  for(let i=0;i<100;i++){try{if((await request('/healthz')).ok)break;}catch{}if(i===99||server.exitCode!==null)throw Error(logs);await delay(100);}
  let r=await request('/setup',form({email:'covers@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Cover fixture'}));assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];
  r=await request('/admin?/create',form({name:'Child cover fixture'}));const eventPath=r.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));await request(eventPath+'/upload');
  db=new Database(path.join(dataDir,'db/app.sqlite'));const intake=db.prepare('SELECT id FROM galleries WHERE event_id=? AND is_intake=1').get(eventId).id;
  const upload=async(n,color)=>{
    const body=await sharp({create:{width:600,height:800,channels:3,background:color}}).jpeg().toBuffer();
    const r=await request(`/admin/api/events/${eventId}/upload?`+new URLSearchParams({gallery:String(intake),filename:`SHOT_${n}.jpg`,role:'print'}),{method:'PUT',body,headers:{'content-type':'application/octet-stream'}});
    assert.equal(r.status,200);const id=(await r.json()).photoId;
    await expect.poll(()=>db.prepare('SELECT rendition_status s FROM photos WHERE id=?').get(id)?.s,{timeout:20000}).toBe('ready');return id;
  };
  const shared=await upload(1,'#987b9b'),soloA=await upload(2,'#5197ad'),soloB=await upload(3,'#d5a65c');
  r=await request(`/admin/api/events/${eventId}/organize`,json({targets:[{kind:'new',key:'cover_child_a_key',label:'PRIVATE CHILD A',photoIds:[shared,soloA]},{kind:'new',key:'cover_child_b_key',label:'PRIVATE CHILD B',photoIds:[shared,soloB]}]}));assert.equal(r.status,200);
  const a=db.prepare("SELECT * FROM galleries WHERE name='PRIVATE CHILD A'").get(),b=db.prepare("SELECT * FROM galleries WHERE name='PRIVATE CHILD B'").get();
  db.prepare('UPDATE events SET is_published=1 WHERE id=?').run(eventId);const event=db.prepare('SELECT * FROM events WHERE id=?').get(eventId),publicPath=`/g/${event.slug}`;
  const snapshot=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','admin_users','admin_sessions'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));const before=snapshot();
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;if(!executablePath)for(const p of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(p);executablePath=p;break;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const owner=await browser.newContext({viewport:{width:1280,height:1000}});const split=cookie.indexOf('=');await owner.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await owner.newPage(),parents=await browser.newPage();for(const p of [page,parents])p.on('pageerror',e=>errors.push(e.message));
  const parentCover=(g)=>parents.locator(`a[href="${publicPath}/c/${g.public_id}"] img`);
  const cover=page.getByRole('region',{name:'Collection cover'});const assertOwnerCover=id=>expect(cover.locator('img')).toHaveAttribute('src',new RegExp(`/media/${id}/thumb`));
  await page.goto(base+eventPath+`?g=${a.id}`,{waitUntil:'networkidle'});await assertOwnerCover(soloA);await expect(cover).toContainText('Automatic');
  await parents.goto(base+publicPath,{waitUntil:'networkidle'});await expect(parentCover(a)).toHaveAttribute('src',new RegExp(`/media/${soloA}/cover640`));await expect(parentCover(b)).toHaveAttribute('src',new RegExp(`/media/${soloB}/cover640`));
  await expect.poll(()=>parentCover(a).evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);assert.ok(!(await parents.locator('body').innerText()).includes('PRIVATE CHILD'));
  pass('Distinct exclusive covers appear in owner and real parent tiles without exposing private child labels');
  await page.locator(`[data-photo-select="${shared}"]`).click();const preview=page.getByRole('dialog',{name:'Photo preview',exact:true});await expect(preview).toBeVisible();
  await preview.getByRole('button',{name:'Use as cover',exact:true}).click();await expect(preview.getByRole('button',{name:'✓ Pinned cover',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await assertOwnerCover(shared);await expect(cover).toContainText('Pinned');
  await page.reload({waitUntil:'networkidle'});await page.getByRole('tab',{name:'Photos',exact:true}).click();await assertOwnerCover(shared);await parents.reload({waitUntil:'networkidle'});await expect(parentCover(a)).toHaveAttribute('src',new RegExp(`/media/${shared}/cover640`));
  pass('A shared image can be explicitly pinned from its large preview and remains pinned after reload');
  await cover.getByRole('button',{name:'Use automatic',exact:true}).click();await assertOwnerCover(soloA);await expect(cover).toContainText('Automatic');
  const tile=page.locator('article').filter({has:page.locator(`[data-photo-select="${shared}"]`)});await tile.getByRole('button',{name:'Use as cover',exact:true}).click();await assertOwnerCover(shared);await cover.getByRole('button',{name:'Use automatic',exact:true}).click();await assertOwnerCover(soloA);
  pass('Photo-card pinning and Use automatic work without changing photo selection or collection membership');
  await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.getByLabel('Automatic collection covers',{exact:true}).selectOption('first');await page.getByRole('button',{name:'Save project settings',exact:true}).click();await page.getByRole('tab',{name:'Photos',exact:true}).click();await assertOwnerCover(shared);await parents.reload({waitUntil:'networkidle'});await expect(parentCover(a)).toHaveAttribute('src',new RegExp(`/media/${shared}/cover640`));
  await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.getByLabel('Automatic collection covers',{exact:true}).selectOption('exclusive');await expect(page.getByLabel('Automatic collection covers',{exact:true})).toHaveValue('exclusive');await page.getByRole('button',{name:'Save project settings',exact:true}).click();await expect.poll(()=>db.prepare('SELECT collection_cover_policy policy FROM events WHERE id=?').get(eventId).policy).toBe('exclusive');await page.getByRole('tab',{name:'Photos',exact:true}).click();await assertOwnerCover(soloA);
  pass('The project can switch automatic cover rules and parent covers follow the saved preference');
  const tags=`/admin/api/events/${eventId}/tags`;r=await request(tags,json({action:'save',name:'Shared shot',shared:true}));const tag=(await r.json()).tag;await request(tags,json({action:'add',photoIds:[shared],tagIds:[tag.id]}));
  await parents.goto(base+publicPath+`?tags=${tag.publicId}`,{waitUntil:'networkidle'});await expect(parentCover(a)).toHaveCount(0);const filteredA=parents.locator(`a[href^="${publicPath}/c/${a.public_id}?"] img`);await expect(filteredA).toHaveAttribute('src',new RegExp(`/media/${shared}/cover640`));
  pass('A filtered branch uses a matching fallback instead of leaking an out-of-filter exclusive cover');
  await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Photos',exact:true}).click();await cover.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.COVER_ARTIFACTS){await mkdir(process.env.COVER_ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(process.env.COVER_ARTIFACTS,'mobile-cover-controls.png')});await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:path.join(process.env.COVER_ARTIFACTS,'desktop-cover-controls.png')});}
  assert.equal(snapshot(),before);assert.deepEqual(errors,[]);
  pass('Narrow-screen controls fit; photos, original bytes, memberships, account and sessions remain identical');
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
} finally {await browser?.close();db?.close();server.kill('SIGTERM');if(server.exitCode===null&&server.signalCode===null)await once(server,'exit');await rm(scratch,{recursive:true,force:true});}
