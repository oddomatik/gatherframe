<script lang="ts">
 import { afterNavigate } from '$app/navigation';
 import { activity } from '$lib/client/activity';
 let {slug,enabled}:{slug:string;enabled:boolean}=$props();
 // Navigation only, never SSR/preload/invalidation. Filter and hash changes aren't new gallery opens.
 afterNavigate(({from,to})=>{
  if(!enabled||!to||from?.url.pathname===to.url.pathname)return;
  const root=`/g/${slug}`,path=to.url.pathname;
  if(path===root)activity(slug,'album_view');
  else if(path===root+'/browse'||path.startsWith(root+'/t/'))activity(slug,'browse_view');
  else{const match=path.slice(root.length).match(/^\/c\/([\w-]+)$/);if(match)activity(slug,'collection_view',{collection:match[1]});}
 });
</script>
