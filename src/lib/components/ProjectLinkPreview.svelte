<script lang="ts">
  import { enhance } from '$app/forms';
  import { thumbUrl } from '$lib/client/api';
  import { toast } from '$lib/client/toast.svelte';
  let { preview, photos, photoId }: {
    preview: { adminImageUrl: string; title: string; kind: string; shareUrl: string };
    photos: { id: number; label: string; hash: string | null; collections: string }[];
    photoId: number | null;
  } = $props();
  let picker = $state(false), search = $state(''), selected = $state<number | null>(null), busy = $state(false);
  const chosen = $derived(selected ?? photoId);
  const matches = $derived(photos.filter(p => `${p.label} ${p.collections}`.toLowerCase().includes(search.toLowerCase())));
  async function copy() { try { await navigator.clipboard.writeText(preview.shareUrl); toast('Link copied.', 'success'); } catch { toast('Copy the event link above.', 'error'); } }
</script>

<section aria-label="Link preview" class="mt-5 border-t border-stone-200 pt-5">
  <h3 class="font-semibold">Link preview</h3>
  <div class="mt-3 grid gap-5 sm:grid-cols-[minmax(0,320px)_1fr]">
    <div class="overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
      <img src={preview.adminImageUrl} alt="Current link preview" class="aspect-[1200/630] w-full object-contain" loading="lazy" />
      <div class="px-3 py-2"><p class="text-sm font-semibold">{preview.title}</p><p class="text-xs text-stone-500">{preview.kind === 'photo' ? 'Album photo' : preview.kind === 'upload' ? 'Custom image' : 'Project title card'}</p></div>
    </div>
    <div>
      <p class="text-xs text-stone-600">This preview is visible in shared links, including for password-protected albums.</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="button-secondary" aria-expanded={picker} onclick={() => picker = !picker}>Choose album photo</button>
        <form method="post" action="?/sharePreview" use:enhance>
          <input type="hidden" name="mode" value="title" /><button class="button-quiet" disabled={preview.kind === 'title'}>Use title card</button>
        </form>
      </div>
      <form method="post" action="?/sharePreview" enctype="multipart/form-data" use:enhance={() => { busy = true; return async ({ update }) => { try { await update(); } finally { busy = false; } }; }} class="mt-4">
        <input type="hidden" name="mode" value="upload" />
        <label class="block text-xs font-medium">Upload a custom image<input name="image" type="file" required accept="image/jpeg,image/png,image/webp" class="mt-2 block w-full text-sm" /></label>
        <p class="mt-1 text-xs text-stone-500">JPEG, PNG or WebP · up to 10 MB · 1200 × 630 recommended</p>
        <button class="button-secondary mt-2" disabled={busy}>{busy ? 'Saving…' : 'Use uploaded image'}</button>
      </form>
      <button type="button" class="mt-4 text-sm underline" onclick={copy}>Copy updated share link</button>
      <p class="mt-1 text-xs text-stone-500">Existing chat messages may keep their old preview.</p>
    </div>
  </div>
  {#if picker}
    <form method="post" action="?/sharePreview" use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') { picker = false; selected = null; } }} class="mt-4">
      <input type="hidden" name="mode" value="photo" /><input type="hidden" name="photoId" value={chosen ?? ''} />
      <input aria-label="Find preview photo or collection" type="search" bind:value={search} placeholder="Find a photo or collection…" class="w-full rounded-lg border border-stone-300 p-2 text-sm" />
      <div class="mt-3 grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
        {#each matches as photo (photo.id)}
          <button type="button" aria-label={`Choose ${photo.label} · ${photo.collections}`} aria-pressed={chosen === photo.id} onclick={() => selected = photo.id} class={`overflow-hidden rounded-xl border-2 text-left ${chosen === photo.id ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white'}`}>
            <img src={thumbUrl(photo.id, photo.hash)} alt="" loading="lazy" class="aspect-[4/3] w-full bg-stone-100 object-contain" />
            <span class="block truncate px-2 pt-2 text-xs">{photo.label}</span><span class="block truncate px-2 pb-2 text-xs text-stone-500">{photo.collections}</span>
          </button>
        {:else}<p class="col-span-full py-5 text-sm text-stone-500">No ready collection photos match.</p>{/each}
      </div>
      <button class="button-primary mt-3" disabled={!chosen}>Use selected photo</button>
    </form>
  {/if}
</section>
