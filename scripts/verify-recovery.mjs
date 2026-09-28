// Real browser + durable HTTP recovery against a disposable server and synthetic data only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`,dataDir=await mkdtemp(path.join(tmpdir(),'picday-recovery-'));
const fixtureEnv={...process.env,DATA_DIR:dataDir,APP_SECRET:randomBytes(32).toString('hex'),SETUP_ENABLED:'1',BODY_SIZE_LIMIT:'Infinity',HOST:'127.0.0.1',PORT:String(port),ORIGIN:base,PUBLIC_ORIGIN:base,NODE_ENV:'production'};
let child,browser,db,cookie='',logs='';const checks=[],errors=[];
function boot(){child=spawn(process.execPath,['server.js'],{env:fixtureEnv,stdio:['ignore','pipe','pipe']});for(const s of [child.stdout,child.stderr])s.on('data',b=>{logs=(logs+b).slice(-14000);});}
async function stop(){child.kill('SIGTERM');await once(child,'exit');}
async function ready(){for(let i=0;i<150;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(logs);}
async function req(url,init={}){return fetch(base+url,{redirect:'manual',...init,headers:{origin:base,cookie,...init.headers}});}
async function post(url,json){return req(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(json)});}
const form=body=>({method:'POST',headers:{accept:'text/html'},body:new URLSearchParams(body)});
const ok=name=>{checks.push(name);console.log('PASS '+name);};
try{
 boot();await ready();let response=await req('/setup',form({email:'recover@example.invalid',password:randomBytes(24).toString('hex'),studioName:'Recovery fixture'}));assert.equal(response.status,303);cookie=response.headers.get('set-cookie').split(';')[0];
 response=await req('/admin?/create',form({name:'Recovery project'}));const eventPath=response.headers.get('location'),eventId=Number(eventPath.split('/').at(-1));
 await req(eventPath+'/upload');db=new Database(path.join(dataDir,'db/app.sqlite'));const galleryId=db.prepare('select id from galleries where is_intake=1 and event_id=?').get(eventId).id;
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/google-chrome'});const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base}]);context.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),new URL(r.url()).pathname);});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const large=randomBytes(10*1024*1024+37),file={name:'RESUME_0001.acr',mimeType:'application/octet-stream',buffer:large};
 let hold=true;const offsets=[];
 await context.route('**/admin/api/transfers/*',async route=>{const r=route.request();if(r.method()==='PATCH'){const offset=Number(r.headers()['upload-offset']);offsets.push(offset);if(hold&&offset>0){await route.abort();return;}}await route.continue();});
 await page.goto(base+eventPath+'/upload');await page.getByLabel('Choose camera raw + edit files files',{exact:true}).setInputFiles([file]);await page.getByRole('button',{name:'Upload files',exact:true}).click();
 await expect.poll(()=>offsets.some(n=>n===8*1024*1024),{timeout:30000}).toBe(true);await page.getByRole('button',{name:'Pause uploads',exact:true}).click();await expect(page.getByRole('button',{name:'Pause uploads',exact:true})).toHaveCount(0);
 const partial=db.prepare('select id from upload_sessions where result is null').get();assert.ok(partial);assert.equal((await stat(path.join(dataDir,'resumable',partial.id))).size,8*1024*1024);assert.equal(db.prepare('select count(*) n from photo_sidecars').get().n,0);
 await stop();boot();await ready();await page.reload();hold=false;offsets.length=0;
 await page.getByLabel('Choose camera raw + edit files files',{exact:true}).setInputFiles([file]);await page.getByRole('button',{name:'Upload files',exact:true}).click();await expect(page.getByText('1 transferred',{exact:true})).toBeVisible({timeout:30000});assert.deepEqual(offsets,[8*1024*1024]);
 assert.equal(db.prepare('select sha256 from photo_sidecars').get().sha256,createHash('sha256').update(large).digest('hex'));ok('Pause, server restart and browser reload resume at 8 MB with exact final bytes');
 await page.reload();offsets.length=0;await page.getByLabel('Choose camera raw + edit files files',{exact:true}).setInputFiles([file]);await page.getByRole('button',{name:'Upload files',exact:true}).click();await expect(page.getByText('1 transferred',{exact:true})).toBeVisible();assert.deepEqual(offsets,[]);ok('Reselection skips identical saved bytes before transfer');
 const jpeg=await sharp({create:{width:80,height:64,channels:3,background:'#b18561'}}).jpeg().toBuffer();
 for(let n=1;n<=3;n++){const r=await req(`/admin/api/events/${eventId}/upload?gallery=${galleryId}&role=print&filename=PHOTO_${n}.jpg`,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:jpeg});assert.equal(r.status,200);}
 const photoIds=db.prepare("select id from photos where stem like 'photo_%' order by id").all().map(p=>p.id);
 await page.goto(base+eventPath);await page.locator(`[data-photo-check="${photoIds[0]}"]`).click();await page.locator(`[data-photo-check="${photoIds[1]}"]`).click();await page.getByRole('button',{name:'Organize 2 photos',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Who’s in these photos?',exact:true});await expect(dialog.getByLabel('New child collection')).toBeEnabled();
 await context.setOffline(true);await dialog.getByLabel('New child collection').fill('Recovered child');await dialog.getByRole('button',{name:'+ Create & assign selected',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Saved on this device');
 const readDraft=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('picture-day-drafts',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('drafts').objectStore('drafts').get('sorting:1:1');q.onsuccess=()=>{db.close();resolve(q.result);};q.onerror=reject;};r.onerror=reject;}));
 const persisted=await readDraft();assert.equal(persisted.draft.targets.find(t=>t.name==='Recovered child').photoIds.length,2);await context.setOffline(false);await page.reload();await page.getByRole('button',{name:'Resume sorting draft',exact:true}).click();await expect(dialog.getByRole('checkbox',{name:'Assign Recovered child',exact:true})).toBeChecked();ok('Offline sorting edits survive an online reload with explicit recovery');
 let lose=true;await page.route('**/admin/api/events/*/organize',async route=>{if(lose){lose=false;const r=await route.fetch();assert.equal(r.status(),200);await route.abort();}else await route.continue();});
 await dialog.getByRole('button',{name:'Save & finish',exact:true}).click();await expect(dialog.getByText('A save needs confirmation.',{exact:false})).toBeVisible();
 assert.equal(db.prepare('select count(*) n from organization_actions').get().n,1);await page.reload();await page.getByRole('button',{name:'Resume sorting draft',exact:true}).click();await dialog.getByRole('button',{name:'Save & finish',exact:true}).click();await expect(dialog).toHaveCount(0);assert.equal(db.prepare('select count(*) n from organization_actions').get().n,1);assert.equal(db.prepare("select count(*) n from galleries where name='Recovered child'").get().n,1);ok('Lost save acknowledgement replays one receipt without duplicate collections');
 await page.getByRole('button',{name:'Undo last sorting save (2 photos)',exact:true}).click();await expect(page.getByText('Sorting assignments undone.',{exact:true})).toBeVisible();for(const id of photoIds.slice(0,2))assert.deepEqual(db.prepare('select gallery_id from gallery_photos where photo_id=?').all(id),[{gallery_id:galleryId}]);ok('Undo restores intake memberships without deleting originals or new collection names');
 // Cross-tab CAS and tombstone protection, using the same actual IndexedDB store/API as the UI.
 
 await page.locator(`[data-photo-check="${photoIds[0]}"]`).click();await page.getByRole('button',{name:'Organize 1 photo',exact:true}).click();await expect(dialog.getByLabel('New child collection')).toBeEnabled();await dialog.getByLabel('New child collection').fill('First tab');await expect(dialog.getByRole('status')).toHaveText('Saved on this device');
 const second=await context.newPage();second.on('dialog',d=>d.accept());await second.goto(base+eventPath);await second.getByRole('button',{name:'Resume sorting draft',exact:true}).click();const d2=second.getByRole('dialog',{name:'Who’s in these photos?',exact:true});await expect(d2.getByRole('status')).toHaveText('Saved on this device');
 await dialog.getByLabel('New child collection').fill('Stale writer');await expect(dialog.getByRole('alert')).toContainText('another tab');assert.notEqual((await readDraft()).draft.newName,'Stale writer');ok('A stale tab cannot overwrite another tab’s saved draft');
 await second.close();await page.close();const quotaPage=await context.newPage();quotaPage.on('dialog',d=>d.accept());await quotaPage.addInitScript(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Synthetic storage full','QuotaExceededError');return put.apply(this,args);};});await quotaPage.goto(base+eventPath);await quotaPage.getByRole('button',{name:'Resume sorting draft',exact:true}).click();const qd=quotaPage.getByRole('dialog',{name:'Who’s in these photos?',exact:true});await qd.getByLabel('New child collection').fill('Kept in memory');await expect(qd.getByRole('alert')).toContainText('memory');await expect(qd.getByLabel('New child collection')).toHaveValue('Kept in memory');await expect(qd.getByRole('status')).not.toHaveText('Saved on this device');ok('Quota failure retains visible edits without falsely acknowledging device persistence');
 await quotaPage.setViewportSize({width:390,height:844});assert.ok(await quotaPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));ok('Recovery controls fit the mobile viewport');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(err){console.error(logs);throw err;}finally{db?.close();await browser?.close();if(child&&child.exitCode===null)await stop();await rm(dataDir,{recursive:true,force:true});}
