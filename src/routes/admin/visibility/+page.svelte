<script lang="ts">
 import {invalidateAll} from '$app/navigation';
 import {formatBytes} from '$lib/client/api';
 let {data}=$props();
 let refreshing=$state(false);
 const n=(key:string)=>data.report.totals[key]??0;
 const dayLabel=(day:string)=>new Date(day+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
 const days=$derived.by(()=>{
  const rows=[];
  for(let d=Date.parse(data.filter.from);d<=Date.parse(data.filter.to);d+=86400000){const day=new Date(d).toISOString().slice(0,10);rows.push(data.report.daily.find(r=>r.day===day)??{day,views:0,favorites:0,downloads:0});}
  return rows;
 });
 const peak=$derived(Math.max(1,...days.map(d=>Math.max(d.views,d.downloads))));
 const roles=$derived(data.report.downloads.reduce((a,r)=>({social:a.social+r.social,print:a.print+r.print,raw:a.raw+r.raw,bytes:a.bytes+r.bytes}),{social:0,print:0,raw:0,bytes:0}));
 const channels:Record<string,string>={file:'Individual file',phone:'Phone share preparation',zip:'ZIP archive',range:'Partial / resumed request'};
 async function refresh(){refreshing=true;try{await invalidateAll();}finally{refreshing=false;}}
 function recent(count:number){const to=new Date().toISOString().slice(0,10),from=new Date(Date.now()-(count-1)*86400000).toISOString().slice(0,10);return '/admin/visibility?'+new URLSearchParams({from,to,...(data.filter.eventId?{event:String(data.filter.eventId)}:{})});}
</script>
<svelte:head><title>Visibility · Gatherframe</title></svelte:head>
<main class="mx-auto max-w-7xl space-y-6">
 <header class="flex flex-wrap items-start justify-between gap-4"><div><p class="eyebrow">Audience activity</p><h1 class="display-title mt-2 text-4xl">Visibility</h1><p class="mt-2 text-sm text-stone-500">Gallery engagement, from the first visit to the download.</p></div><button type="button" class="button-secondary" disabled={refreshing} onclick={refresh}>{refreshing?'Refreshing…':'Refresh stats'}</button></header>
 <form method="get" class="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4">
  <label class="min-w-44 flex-1 text-xs font-medium">Project<select name="event" value={data.filter.eventId??''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm"><option value="">All projects</option>{#each data.events as e}<option value={e.id}>{e.name}</option>{/each}</select></label>
  <label class="text-xs font-medium">From<input name="from" type="date" value={data.filter.from} class="mt-1 block rounded-lg border border-stone-300 p-2.5 text-sm" /></label>
  <label class="text-xs font-medium">Through<input name="to" type="date" value={data.filter.to} class="mt-1 block rounded-lg border border-stone-300 p-2.5 text-sm" /></label>
  <button class="button-primary">Apply</button><div class="flex gap-3 py-2 text-xs">{#each [7,30,90] as count}<a class="underline" href={recent(count)}>{count} days</a>{/each}</div>
 </form>
 <p class="text-xs text-stone-500">Tracking since {new Date(data.report.startedAt).toLocaleString()}. Dates are UTC · last 90 days retained.</p>
 {#if !Object.keys(data.report.totals).length}<div class="notice"><strong>No guest activity in this period yet.</strong><p class="mt-1 text-sm">Activity starts with this release. Past visits, family pins and favorites cannot be reconstructed. Signed-in photographer browsing is excluded.</p></div>{/if}
 <section aria-label="Engagement totals" class="grid grid-cols-2 gap-3 lg:grid-cols-3">
  {#each [
   {label:'Gallery views',value:n('album_view')+n('collection_view')+n('browse_view'),detail:`${n('album_view')} album · ${n('collection_view')} collection · ${n('browse_view')} browse`},
   {label:'Guest browsers',value:data.report.browsers,detail:'Approximate; per project, not unique people'},
   {label:'My family adds',value:n('family_add'),detail:`${n('family_remove')} removals in this period`},
   {label:'Favorite adds',value:n('favorite_add'),detail:`${n('favorite_remove')} removals in this period`},
   {label:'Photo previews',value:n('photo_view'),detail:'Large-view opens, including next/previous'},
   {label:'Downloads sent',value:n('download_complete'),detail:`${n('download_start')} requests · ${roles.social+roles.print+roles.raw} files sent`}
  ] as card}<article class="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5"><h2 class="text-sm font-medium text-stone-600">{card.label}</h2><p class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{card.value.toLocaleString()}</p><p class="mt-2 text-xs text-stone-500">{card.detail}</p></article>{/each}
 </section>
 <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Daily activity">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold">Daily activity</h2><p class="flex gap-4 text-xs"><span><span class="mr-1 inline-block h-2 w-2 rounded-full bg-stone-700"></span>Gallery views</span><span><span class="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600"></span>Downloads sent</span></p></div>
  <div class="mt-5 flex h-40 items-end gap-0.5 border-b border-stone-200" role="img" aria-label="Daily views and downloads. Exact counts in daily totals below.">
   {#each days as d}<div class="flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${d.day}: ${d.views} views, ${d.downloads} downloads`}><div class="w-2/5 rounded-t bg-stone-700" style:height={`${100*d.views/peak}%`}></div><div class="w-2/5 rounded-t bg-emerald-600" style:height={`${100*d.downloads/peak}%`}></div></div>{/each}
  </div><div class="mt-2 flex justify-between text-xs text-stone-500"><span>{dayLabel(data.filter.from)}</span><span>{dayLabel(data.filter.to)}</span></div>
  <details class="mt-4 text-sm"><summary class="cursor-pointer">Daily totals</summary><div class="mt-3 max-h-64 overflow-auto"><table class="metrics-table"><thead><tr><th>Date (UTC)</th><th>Views</th><th>Favorite adds</th><th>Downloads sent</th></tr></thead><tbody>{#each [...days].reverse() as d}<tr><th>{d.day}</th><td>{d.views}</td><td>{d.favorites}</td><td>{d.downloads}</td></tr>{/each}</tbody></table></div></details>
 </section>
 <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Downloads by type"><h2 class="text-lg font-semibold">Downloads</h2><p class="mt-1 text-xs text-stone-500">Full response sent by the server—not proof of a save to the device. Retries can count again; partial transfers are requests only.</p>
  <div class="my-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{#each [{label:'Full-resolution files',count:roles.print},{label:'Social-size files',count:roles.social},{label:'RAW files',count:roles.raw}] as role}<div><p class="text-2xl font-semibold">{role.count.toLocaleString()}</p><p class="text-xs text-stone-500">{role.label}</p></div>{/each}<div><p class="text-2xl font-semibold">{formatBytes(roles.bytes)}</p><p class="text-xs text-stone-500">Source file bytes sent</p></div></div>
  <div class="overflow-x-auto"><table class="metrics-table"><thead><tr><th>Delivery</th><th>Transfers sent</th><th>Full-resolution</th><th>Social</th><th>RAW</th></tr></thead><tbody>{#each data.report.downloads as row}<tr><th>{channels[row.channel]??row.channel}</th><td>{row.transfers}</td><td>{row.print}</td><td>{row.social}</td><td>{row.raw}</td></tr>{:else}<tr><td colspan="5">No complete downloads recorded.</td></tr>{/each}</tbody></table></div>
 </section>
 <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Collection engagement"><h2 class="text-lg font-semibold">Collections</h2><p class="mt-1 text-xs text-stone-500">Top 50 by opens</p><div class="mt-4 overflow-x-auto"><table class="metrics-table"><thead><tr><th>Collection</th><th>Opens</th><th>Family adds</th><th>Removals</th></tr></thead><tbody>{#each data.report.collections as row}<tr><th><a class="underline" href={`/admin/events/${row.eventId}`}>{row.name||'Unnamed collection'}</a>{#if !data.filter.eventId}<span class="block text-xs font-normal text-stone-500">{row.project}</span>{/if}</th><td>{row.views}</td><td>{row.adds}</td><td>{row.removes}</td></tr>{:else}<tr><td colspan="4">No collection activity yet.</td></tr>{/each}</tbody></table></div></section>
 <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Photo engagement"><h2 class="text-lg font-semibold">Photos getting attention</h2><p class="mt-1 text-xs text-stone-500">Top 30 by favorite adds</p><div class="mt-4 overflow-x-auto"><table class="metrics-table"><thead><tr><th>Photo</th><th>Previews</th><th>Favorite adds</th><th>Removals</th></tr></thead><tbody>{#each data.report.photos as row}<tr><th>{row.stem}{#if !data.filter.eventId}<span class="block text-xs font-normal text-stone-500">{row.project}</span>{/if}</th><td>{row.views}</td><td>{row.adds}</td><td>{row.removes}</td></tr>{:else}<tr><td colspan="4">No photo activity yet.</td></tr>{/each}</tbody></table></div></section>
 <details class="text-sm text-stone-600"><summary class="cursor-pointer">How these numbers work</summary><div class="mt-3 max-w-3xl space-y-2 text-xs leading-relaxed"><p>Views count loaded guest pages, not link preloads or sharing-crawler requests. Known bots and signed-in photographer sessions are excluded. A browser opened on another device or with cleared cookies counts separately; the same browser in different projects is counted separately.</p><p>Family and favorite counts are actions during the selected period, not current saved totals or identified parents. Existing device-local choices are not imported. Blocked analytics, offline activity and unknown bots can affect counts.</p><p>Phone share preparation means files reached the browser for its share sheet. It does not confirm that the sheet was used or that a photo was saved. ZIP file counts include each requested version. No parent names, email addresses, IP addresses, referral URLs or cross-site identifiers are stored in these metrics.</p></div></details>
</main>
<style>
 .metrics-table{width:100%;border-collapse:collapse;font-size:.875rem;text-align:left}.metrics-table th,.metrics-table td{padding:.7rem .6rem;border-bottom:1px solid #e7e5e4}.metrics-table thead{font-size:.75rem;color:#78716c}.metrics-table tbody th{font-weight:500}.metrics-table td:not(:first-child),.metrics-table th:not(:first-child){text-align:right}.metrics-table th:first-child{min-width:9rem}
</style>
