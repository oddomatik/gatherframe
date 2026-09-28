<script lang="ts">
  import Builder from '$lib/components/Builder.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Order prints · {data.event.name}</title></svelte:head>

{#if data.gallery && data.catalog}
  {#key data.gallery.publicId}
  <Builder event={data.event} gallery={data.gallery} photos={data.photos} siblings={data.siblings} catalog={data.catalog} initialPhotoId={data.initialPhotoId} studio={data.studio} venmoAvailable={!!data.venmoHandle} fromFavorites={data.fromFavorites} emailUpdatesAvailable={data.emailUpdatesAvailable} />
  {/key}
{/if}
