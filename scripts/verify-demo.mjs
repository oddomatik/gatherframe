// Isolated demo access/content rehearsal. Uses generated test images, never a live host.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';
import {verifyPrintPlanner} from './verify-print-planner.mjs';
const root=await mkdtemp(path.join(tmpdir(),'gatherframe-demo-test-')),data=path.join(root,'data'),photos=path.join(root,'photos');
await mkdir(photos);
const names=['coast-wide','coast-detail','forest-wide','forest-detail','meadow-wide','meadow-detail'];
for(let i=0;i<names.length;i++)await sharp({create:{width:i%2?800:1200,height:i%2?1200:800,channels:3,background:['#809aab','#899077','#c1a77d'][Math.floor(i/2)]}}).png().toFile(path.join(photos,names[i]+'.png'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(args){const c=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let output='';c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);const [code]=await once(c,'exit');return {code,output};}
let child,browser,db,base,logs='';const checks=[];const ok=s=>{checks.push(s);console.log('PASS '+s);};
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}child=undefined;}
async function start(demo,extra={}){
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}`;logs='';
 child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',DATA_DIR:data,DEMO_MODE:demo?'1':'0',SETUP_ENABLED:'0',HOST:'127.0.0.1',PORT:String(port),ORIGIN:base,PUBLIC_ORIGIN:base,APP_SECRET:randomBytes(32).toString('hex'),B2_KEY_ID:'',B2_APPLICATION_KEY:'',...extra},stdio:['ignore','pipe','pipe']});
 for(const s of [child.stdout,child.stderr])s.on('data',b=>logs=(logs+b).slice(-8000));
 for(let i=0;i<150;i++){if(child.exitCode!==null)return false;try{if((await fetch(base+'/healthz')).ok)return true;}catch{}await delay(100);}throw Error(logs);
}
const req=(url,method='GET')=>fetch(base+url,{method,redirect:'manual',headers:{origin:base,accept:'text/html'},...(method==='POST'?{body:new URLSearchParams({name:'Do not save'})}:{})});
try{
 let r=await run(['scripts/seed-demo.mjs',data,photos]);assert.equal(r.code,0,r.output);
 r=await run(['scripts/seed-demo.mjs',data,photos]);assert.notEqual(r.code,0);assert.match(r.output,/Refusing to overwrite/);ok('Seeder refuses an existing database');
 db=new Database(path.join(data,'db/app.sqlite'));
 const marker=db.prepare("SELECT value FROM settings WHERE key='demoFixture'").get().value;
 db.prepare("DELETE FROM settings WHERE key='demoFixture'").run();assert.equal(await start(true),false);assert.match(logs,/isolated, seeded demo fixture/);await stop();
 db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('demoFixture',?,?)").run(marker,new Date().toISOString());
 assert.equal(await start(true,{SETUP_ENABLED:'1'}),false);assert.match(logs,/must not enable setup/);await stop();ok('Demo mode refuses ordinary databases and enabled setup');
 assert.equal(await start(true,{B2_KEY_ID:'demo-rejected-credential'}),false);assert.match(logs,/must not enable setup/);await stop();
 assert.equal(await start(true),true,logs);
 const fingerprint=()=>JSON.stringify(Object.fromEntries(['photos','photo_files','gallery_photos','orders','payments','settings','guest_activity','catalogs','print_sizes','sheet_templates','sheet_template_cells','products','product_sheets','event_products','order_items','order_item_sheets','order_item_cells'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const before=fingerprint();
 for(const p of ['/','/admin','/admin/events/1','/admin/orders','/admin/orders/1','/admin/visibility','/admin/catalog','/admin/storage','/admin/settings','/g/field-notes','/g/field-notes/c/coast','/o/sample-receipt-1']){const response=await req(p);assert.equal(response.status,200,p);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');}
 assert.equal((await req('/setup')).status,404);
 assert.equal((await req('/media/1/thumb')).status,200);
 assert.equal((await req('/media/1/cover640')).status,200);
 for(const [p,m] of [['/admin/settings?/save','POST'],['/admin?/create','POST'],['/admin/api/events/1/upload','PUT'],['/admin/api/events/1/tags','POST'],['/g/field-notes/api/orders','POST'],['/admin/api/events/1/organize','DELETE'],['/g/field-notes/api/orders','PATCH']])assert.equal((await req(p,m)).status,403,p);
 assert.equal((await req('/g/field-notes/api/activity','POST')).status,204);ok('Public demo reads work; setup, uploads, edits and orders are blocked before routing');
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;for(const c of [chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome']){if(executablePath)break;try{await access(c);executablePath=c;}catch{}}
 browser=await chromium.launch({headless:true,executablePath});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});const errors=[],outbound=[];
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():(outbound.push(r.request().url()),r.abort()));const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});await page.goto(base,{waitUntil:'networkidle'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);await expect(page.getByRole('heading',{name:'The demo studio.'})).toBeVisible();assert.ok(await page.locator('.demo-hero-photo img').evaluate(i=>i.complete&&i.naturalWidth>0));}
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/g/field-notes/c/coast',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Take a closer look at photo 1',exact:true}).click();const viewer=page.locator('.gatherframe-viewer');await expect(viewer).toHaveAttribute('data-photo-id','1');assert.deepEqual(await viewer.boundingBox(),{x:0,y:0,width:390,height:844});await expect(viewer).toHaveClass(/pswp--ui-visible/);await delay(400);
 const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:400,id:1}]});for(let i=1;i<=9;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:330-i*30,y:400,id:1}]});await delay(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(viewer).toHaveAttribute('data-photo-id','2');await delay(350);if(!await viewer.evaluate(e=>e.classList.contains('pswp--ui-visible')))await page.touchscreen.tap(195,400);
 await viewer.getByRole('button',{name:'♡ Favorite',exact:true}).click();await viewer.getByRole('button',{name:'Close photo preview',exact:true}).click();await page.reload({waitUntil:'networkidle'});await expect(page.getByRole('button',{name:'Remove favorite photo 2',exact:true})).toBeVisible();ok('Responsive landing and mobile full-screen swipe work; favorites persist locally');
 await page.goto(base+'/admin/events/1',{waitUntil:'networkidle'});for(const img of await page.locator('img:visible').all()){await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}
 await page.goto(base+'/admin/events/1/upload',{waitUntil:'networkidle'});for(const input of await page.locator('input[type=file]').all())await expect(input).toBeDisabled();
 await page.goto(base+'/admin/settings',{waitUntil:'networkidle'});const firstForm=page.locator('form[method=post]').first();await firstForm.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await expect(page.getByText('This is a read-only demo. Your changes have not been saved.')).toBeVisible();ok('Studio save attempts explain read-only state and file selectors are disabled');
 await verifyPrintPlanner(page,base,process.env.PRINT_PLANNER_EVIDENCE);ok('Optional print planner works with synthetic catalog content and no server writes');
 const zip=await context.request.post(base+'/g/field-notes/api/zip',{data:{photoIds:[1,2],roles:['print']}});assert.equal(zip.status(),200);const zipInfo=await zip.json();assert.equal(zipInfo.files,2);const archive=await context.request.get(base+zipInfo.url);assert.equal(archive.status(),200);assert.equal((await archive.body()).subarray(0,2).toString(),'PK');ok('Sample original downloads produce a real ZIP without altering illustrative activity');
 // Exercise the real print layout, quote and checkout UI.
 await page.goto(base+'/g/field-notes/c/coast/order',{waitUntil:'networkidle'});
 await page.goto(base+'/g/field-notes/c/coast/order?photo=1',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Add',exact:true}).last().click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Sample order preview',exact:true})).toBeVisible();await expect(page.locator('form#checkout')).toHaveCount(0);await expect(page.locator('input[type=email],input[type=tel],input[autocomplete=name]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Place order',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Sample receipt ↗',exact:true})).toBeVisible();ok('Print quote and checkout work without contact fields or order submission');
 assert.equal(fingerprint(),before,'Demo changed shared fixture content');assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);ok('Shared fixture content is unchanged and browser has no runtime errors or external calls');
 await browser.close();browser=undefined;await stop();assert.equal(await start(false),true);assert.equal((await req('/')).status,302);assert.equal((await req('/admin')).status,303);assert.equal((await req('/admin/catalog/planner')).status,303);assert.equal((await req('/admin/api/events/1/photos')).status,401);assert.equal((await req('/media/1/thumb')).status,403);ok('Ordinary mode retains authenticated studio access');
 console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser?.close();await stop();db?.close();await rm(root,{recursive:true,force:true});}
