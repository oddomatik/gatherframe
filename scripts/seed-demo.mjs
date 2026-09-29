// Seed an EMPTY data directory with original sample photographs. Never resets data.
// Run after npm run build: node scripts/seed-demo.mjs /new/demo-data /path/to/photos
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const [dataArg, photosArg] = process.argv.slice(2);
if (!dataArg || !photosArg) throw Error('Usage: node scripts/seed-demo.mjs EMPTY_DATA_DIR PHOTO_DIR');
const dataDir = path.resolve(dataArg), photosDir = path.resolve(photosArg);
const names = ['coast-wide', 'coast-detail', 'forest-wide', 'forest-detail', 'meadow-wide', 'meadow-detail'];
for (const name of names) await access(path.join(photosDir, name + '.png'));
const dbPath = path.join(dataDir, 'db/app.sqlite');
try { await access(dbPath); throw Error('Refusing to overwrite an existing database. Choose a new, empty demo data directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(dataDir, { recursive: true });
const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV:'production', DEMO_MODE:'0', SETUP_ENABLED:'1', HOST:'127.0.0.1', PORT:String(port), ORIGIN:base, PUBLIC_ORIGIN:base, DATA_DIR:dataDir, APP_SECRET:randomBytes(32).toString('hex'), B2_KEY_ID:'', B2_APPLICATION_KEY:'' }, stdio:['ignore','pipe','pipe'] });
let log = '', db;
for (const stream of [child.stdout,child.stderr]) stream.on('data', b => { log = (log + b).slice(-6000); });
try {
  for (let i=0;i<200;i++) { try { if ((await fetch(base+'/healthz')).ok) break; } catch {} if(i===199 || child.exitCode!==null) throw Error(log); await new Promise(r=>setTimeout(r,100)); }
  const r=await fetch(base+'/setup',{method:'POST',redirect:'manual',headers:{origin:base,accept:'text/html'},body:new URLSearchParams({email:'studio@example.invalid',password:randomBytes(32).toString('hex'),studioName:'Gatherframe demo studio'})});
  assert.equal(r.status,303,'Private demo bootstrap failed');
  db=new Database(dbPath);db.pragma('foreign_keys=ON');
  const now=new Date().toISOString(), daysAgo=n=>new Date(Date.now()-n*86400000).toISOString();
  const setting=(key,value)=>db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key,JSON.stringify({v:value}),now);
  for(const [key,value] of Object.entries({studioName:'Gatherframe demo studio',photographerName:'Sample studio',contactLine:'Original AI-generated sample photography',adminEmail:'',venmoHandle:'',paymentInstructionsMd:'Demonstration only. No payments or orders are accepted.',smtp:null,gotify:null,webhook:null,notifyEmail:false,notifyGotify:false,notifyWebhook:false,zipStreamMaxBytes:50000000}))setting(key,value);
  db.prepare(`INSERT INTO events(id,slug,name,subject_label,is_published,variant_policy,ordering_enabled,parent_message,pickup_instructions,created_at,updated_at)
    VALUES(1,'field-notes','Field notes','collection',1,?,1,?,?,?,?)`).run(JSON.stringify({print:'free',social:'free',raw:'disabled'}),'Explore the coast, woodland and meadow. These photographs were generated for this demo.','Sample studio pickup — demonstration only.',now,now);
  db.prepare("INSERT INTO galleries(id,event_id,public_id,name,is_intake,created_at) VALUES(1,1,'demo-intake','Unsorted',1,?)").run(now);
  const collections=[['coast','The coast',1],['woodland','The woodland',3],['meadow','The meadow',5]];
  for(let i=0;i<collections.length;i++) {const [slug,name,cover]=collections[i];db.prepare('INSERT INTO galleries(id,event_id,public_id,name,sort_order,cover_photo_id,created_at) VALUES(?,1,?,?,?,?,?)').run(i+2,slug,name,i,cover,now);}
  const hashes=[];
  for(let i=0;i<names.length;i++) {
    const id=i+1, source=await readFile(path.join(photosDir,names[i]+'.png'));
    const full=await sharp(source).rotate().jpeg({quality:92}).toBuffer(), meta=await sharp(full).metadata(),hash=createHash('sha256').update(full).digest('hex');hashes.push(hash);
    db.prepare('INSERT INTO photos(id,gallery_id,stem,display_name,taken_at,width,height,render_source_role,rendition_status,rendition_hash,sort_order,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,\'ready\',?,?,?,?)').run(id,names[i],names[i].replaceAll('-',' '),daysAgo(7-i),meta.width,meta.height,'print',hash,i,now,now);
    db.prepare('INSERT INTO gallery_photos(gallery_id,photo_id) VALUES(?,?)').run(2+Math.floor(i/2),id);
    for(const [role,bytes] of [['print',full],['social',await sharp(full).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).jpeg({quality:86}).toBuffer()]]) {
      const digest=createHash('sha256').update(bytes).digest('hex'), rel=`originals/1/objects/${digest}.jpg`, metadata=await sharp(bytes).metadata();
      await mkdir(path.dirname(path.join(dataDir,rel)),{recursive:true});await writeFile(path.join(dataDir,rel),bytes);
      db.prepare('INSERT INTO photo_files(photo_id,role,original_filename,ext,mime,bytes,sha256,width,height,storage_path,created_at) VALUES(?,?,?,\'jpg\',\'image/jpeg\',?,?,?,?,?,?)').run(id,role,names[i]+'.jpg',bytes.length,digest,metadata.width,metadata.height,rel,now);
      db.prepare('INSERT OR IGNORE INTO storage_objects(storage_path,sha256,bytes,mime,local_available,local_verified_at,created_at,updated_at) VALUES(?,?,?,\'image/jpeg\',1,?,?,?)').run(rel,digest,bytes.length,now,now,now);
    }
    const dir=path.join(dataDir,'derivatives/1',String(id));await mkdir(dir,{recursive:true});
    for(const [kind,size] of [['thumb',400],['preview',1600],['web',2560]])await sharp(full).resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toFile(path.join(dir,kind+'.webp'));
  }
  db.prepare('UPDATE events SET cover_photo_id=1,share_photo_id=1 WHERE id=1').run();
  for(const [id,name,parent] of [[1,'Light',null],[2,'Soft light',1],[3,'Golden hour',1],[4,'Portrait',null],[5,'Landscape',null]])db.prepare('INSERT INTO tags(id,event_id,public_id,parent_id,name,shared,created_at) VALUES(?,1,?,?,?,1,?)').run(id,'demo-tag-'+id,parent,name,now);
  for(let id=1;id<=6;id++){db.prepare('INSERT INTO photo_tags(photo_id,tag_id) VALUES(?,?)').run(id,id%2?5:4);db.prepare('INSERT INTO photo_tags(photo_id,tag_id) VALUES(?,?)').run(id,[1,5,6].includes(id)?3:2);}
  for(let i=0;i<3;i++) {
    const id=i+1,photoId=1+i*2,date=daysAgo(2+i),status=['new','printed','delivered'][i];
    db.prepare('INSERT INTO orders(id,order_number,access_token,idempotency_key,event_id,gallery_id,customer_name,subject_name,notes,status,subtotal_cents,total_cents,currency,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,1800,1800,\'USD\',?,?)').run(id,'DEMO-100'+id,'sample-receipt-'+id,'sample-intent-'+id,2+i,['Alex Example','Sam Sample','Taylor Demo'][i],collections[i][1],i===0?'Please keep the soft, warm tones. Sample request only.':'Fictional demo order.',status,date,date);
    db.prepare('INSERT INTO order_items(id,order_id,product_code,product_name,product_kind,quantity,unit_price_cents,total_cents) VALUES(?,?,\'DEMO-8X10\',\'8 × 10 print\',\'single\',1,1800,1800)').run(id,id);
    db.prepare('INSERT INTO order_item_sheets(id,order_item_id,sheet_index,template_code,label,paper_width_in,paper_height_in) VALUES(?,?,0,\'DEMO-8X10\',\'8 × 10 print\',10,8)').run(id,id);
    db.prepare('INSERT INTO order_item_cells(id,order_item_sheet_id,cell_index,print_size_code,label,w_in,h_in,x_in,y_in,photo_id,photo_stem,gallery_id,gallery_name,print_sha256) VALUES(?,?,0,\'8x10\',\'8 × 10\',10,8,0,0,?,?,?,?,?)').run(id,id,photoId,names[photoId-1],2+i,collections[i][1],hashes[photoId-1]);
    if(i)db.prepare('INSERT INTO payments(order_id,method,amount_cents,reference,paid_at,created_at) VALUES(?,\'cash\',1800,\'Illustrative payment — no money received\',?,?)').run(id,date,date);
  }
  const kinds=['album_view','collection_view','photo_view','favorite_add','family_add','download_complete'];
  for(let day=0;day<14;day++)for(let j=0;j<9+day%5;j++) {
    const kind=kinds[j%kinds.length],photo=1+j%6;
    db.prepare('INSERT INTO guest_activity(id,event_id,visitor,kind,gallery_id,photo_id,channel,print_files,bytes,created_at) VALUES(?,1,?,?,?,?,?,?,?,?)').run(`sample-${day}-${j}`,`sample-visitor-${j%7}`,kind,2+Math.floor((photo-1)/2),photo,kind==='download_complete'?'individual':null,kind==='download_complete'?1:0,kind==='download_complete'?480000:0,daysAgo(day));
  }
  db.prepare("UPDATE activity_meta SET value=? WHERE key='started_at'").run(daysAgo(14));
  db.exec('DELETE FROM admin_sessions');setting('demoFixture','gatherframe-showcase-v1');
  assert.equal(db.pragma('quick_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
  console.log(JSON.stringify({seeded:true,photos:6,collections:3,orders:3,dataDir,fixture:'gatherframe-showcase-v1'}));
} finally {
  db?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
}
