<script lang="ts">
  import { enhance } from '$app/forms';
  let {data,form}=$props();
</script>
<svelte:head><title>Sharing & proofing · {data.event.name}</title></svelte:head>
<a href={`/admin/events/${data.event.id}#project-sharing`} class="button-quiet">← {data.event.name}</a>
<h1 class="mt-5 text-3xl font-semibold">Scoped sharing & proofing</h1>
<p class="mt-3 max-w-3xl text-stone-600">Each invitation can access only its selected collections, including photos added later. Anyone holding a link can use it; the private recipient label does not verify their identity. Project publication, password and expiry still apply.</p>
{#if form?.error}<p role="alert" class="notice mt-4">{form.error}</p>{/if}
{#if form?.ok}<p role="status" class="notice mt-4">{form.ok}</p>{/if}
{#if form?.shareUrl}<label class="mt-4 block font-medium">New invitation link<input aria-label="New invitation link" readonly value={form.shareUrl} class="mt-2 w-full rounded-lg border p-3" onclick={e=>e.currentTarget.select()} /></label>{/if}
<section class="my-6 rounded-xl border bg-white p-5">
<h2 class="text-xl font-semibold">Project access mode</h2>
<p class="mt-2 text-sm">{data.event.scopedSharingOnly?'The broad project link is disabled for guests. Only active scoped invitations work.':'The original project link still exposes all shared collections. Creating a scoped link alone does not make the project private.'}</p>
<form method="post" action="?/mode" use:enhance class="mt-4 space-y-3"><label class="flex gap-2"><input type="checkbox" name="scopedOnly" checked={data.event.scopedSharingOnly} /> Only allow scoped invitations</label><p class="text-xs text-stone-500">Disables existing broad gallery links, public share images and broad media/download capabilities. Previously downloaded files cannot be recalled. Photographer previews and independent saved-order receipts remain available.</p><button class="button-primary">Save access mode</button></form>
</section>
<section class="my-6 rounded-xl border bg-white p-5"><h2 class="text-xl font-semibold">Create invitation</h2>
<form method="post" action="?/create" use:enhance class="mt-4 space-y-4">
<label class="block">Private recipient label<input name="label" maxlength="120" required class="mt-1 block w-full rounded-lg border p-2" /></label>
<fieldset><legend>Allowed collections</legend><div class="mt-2 grid gap-2 sm:grid-cols-2">{#each data.collections as c}<label class="flex gap-2"><input type="checkbox" name="collections" value={c.id} />{c.name}</label>{/each}</div></fieldset>
<label class="flex gap-2"><input type="checkbox" name="downloads" /> Allow project-enabled original/version downloads</label><p class="text-xs text-stone-500">View-only links still show photographic previews, which a visitor can save. Print ordering follows the project setting and is limited to the allowed photos.</p>
<label class="block">Expires at (UTC, optional)<input type="datetime-local" name="expiresAt" class="mt-1 block max-w-full rounded-lg border p-2" /></label><button class="button-primary">Create invitation</button></form></section>
<h2 class="text-xl font-semibold">Invitations</h2>
{#each data.grants as g}<article class="my-4 rounded-xl border bg-white p-5"><h3 class="font-semibold">{g.label}</h3><p class="mt-2 text-sm">{g.active?'Active':g.revoked_at?'Revoked':'Expired'} · {g.downloads?'Downloads enabled':'View only'}{g.expires_at?` · Expires ${g.expires_at}`:''}</p><p class="mt-2 text-sm">Collections: {g.collectionIds.map(id=>data.collections.find(c=>c.id===id)?.name??'Unavailable collection').join(', ')}</p>
{#if g.active}<form method="post" action="?/change" use:enhance class="mt-3 flex flex-wrap gap-3"><input type="hidden" name="grantId" value={g.id} /><button name="action" value="rotate" class="button-secondary">Rotate link</button><button name="action" value="revoke" class="button-secondary">Revoke invitation</button></form>
<form method="post" action="?/proof" use:enhance class="mt-4 flex flex-wrap gap-2"><input type="hidden" name="grantId" value={g.id} /><label class="flex-1">Public selection-round title<input aria-label={`Selection title for ${g.label}`} name="title" maxlength="120" required placeholder="Choose your final images" class="mt-1 block w-full rounded-lg border p-2" /></label><button class="button-primary self-end">Create selection round</button></form>{/if}
{#each data.rounds.filter(r=>r.grantId===g.id) as r}<a class="mt-3 block underline" href={`/admin/events/${data.event.id}/proofs/${r.id}`}>{r.title} · {r.status}</a>{/each}
</article>{:else}<p class="mt-4 text-stone-500">No scoped invitations yet.</p>{/each}
