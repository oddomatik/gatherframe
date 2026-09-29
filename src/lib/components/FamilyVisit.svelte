<script lang="ts">
  import { activity } from '$lib/client/activity';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { loadFamily,saveFamily } from '$lib/client/family';
  import { toast } from '$lib/client/toast.svelte';
  let {eventId,pid,photoIds}:{eventId:number;pid:string|null;photoIds:number[]}=$props();
  let pinned=$state(false), loaded=$state(false);
  onMount(()=>{
    const path=page.url.pathname+page.url.search, state=loadFamily(eventId);
    pinned=!!pid&&state.pins.includes(pid);loaded=true;
    try{if(pid)saveFamily(eventId,s=>{s.seen[pid!]=photoIds;});}catch{/* Browsing does not depend on local storage. */}
    let timer:ReturnType<typeof setTimeout>|undefined;
    const restore=setTimeout(()=>{
      if(page.url.hash || page.url.searchParams.has('photo'))return;
      const saved=state.positions[path];if(!saved)return;
      const card=saved.photoId?document.querySelector(`[data-guest-photo="${saved.photoId}"]`):null;
      if(card)card.scrollIntoView({block:'start'});else window.scrollTo(0,Math.max(0,saved.y));
    },150);
    const persist=()=>{
      const card=[...document.querySelectorAll<HTMLElement>('[data-guest-photo]')].find(el=>el.getBoundingClientRect().bottom>120);
      try{saveFamily(eventId,s=>{delete s.positions[path];s.positions[path]={y:window.scrollY,photoId:card?Number(card.dataset.guestPhoto):null};});}catch{}
    };
    const scroll=()=>{clearTimeout(timer);timer=setTimeout(persist,250);};
    window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('pagehide',persist);
    return()=>{clearTimeout(restore);clearTimeout(timer);persist();window.removeEventListener('scroll',scroll);window.removeEventListener('pagehide',persist);};
  });
  function toggle(){if(!pid)return;try{const state=saveFamily(eventId,s=>{s.pins=s.pins.includes(pid!)?s.pins.filter(p=>p!==pid):[pid!,...s.pins];});pinned=state.pins.includes(pid);activity(page.params.slug!,pinned?'family_add':'family_remove',{collection:pid});}catch{toast('This browser could not remember the collection. You can still browse and use its link.','error');}}
</script>
{#if pid}<button type="button" class="button-secondary family-visit" aria-label={pinned?'Remove saved collection':'Save collection'} aria-pressed={pinned} disabled={!loaded} onclick={toggle}><span aria-hidden="true">{pinned?'★':'☆'}</span><span>{pinned?'Saved collection':'Save collection'}</span></button>{/if}
