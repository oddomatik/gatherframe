<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from '$lib/client/toast.svelte';
  import { page } from '$app/state';
  import Toasts from '$lib/components/Toasts.svelte';
  let { data, children } = $props();
  onMount(() => {
    const guard = (event: SubmitEvent) => {
      if (!data.demo || !(event.target instanceof HTMLFormElement) || event.target.method.toLowerCase() === 'get') return;
      event.preventDefault(); event.stopImmediatePropagation();
      toast('This is a read-only demo. Your changes have not been saved.');
    };
    document.addEventListener('submit', guard, true);
    return () => document.removeEventListener('submit', guard, true);
  });
  const nav = [
    { href: '/admin', label: 'Events' },
    { href: '/admin/visibility', label: 'Visibility' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/catalog', label: 'Catalog' },
    { href: '/admin/storage', label: 'Storage' },
    { href: '/admin/settings', label: 'Studio settings' }
  ];
  const active = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/events') : page.url.pathname.startsWith(href));
</script>

<Toasts />
{#if data.admin}
  <div class="admin-shell min-h-screen md:flex">
    <aside class="border-b border-stone-200 bg-white md:w-56 md:shrink-0 md:border-b-0 md:border-r">
      <div class="flex items-center justify-between px-4 py-3 md:block">
        <a href="/admin" class="font-semibold">{data.studioName}</a>
        {#if data.demo}<span class="mt-1 block text-xs text-stone-500">Read-only studio tour</span>{:else}<form method="post" action="/admin/logout" class="md:mt-1"><button class="text-xs text-stone-500 hover:underline">Sign out</button></form>{/if}
      </div>
      <nav class="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
        {#each nav as n (n.href)}
          <a href={n.href} class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${active(n.href) ? 'bg-stone-900 text-white' : 'hover:bg-stone-100'}`}>
            {n.label}
            {#if n.href === '/admin/orders' && data.newOrders > 0}<span class="ml-auto rounded-full bg-amber-500 px-2 text-xs font-semibold text-stone-900">{data.newOrders}</span>{/if}
          </a>
        {/each}
      </nav>
    </aside>
    <div class="min-w-0 flex-1 p-4 md:p-6">{#if data.demo}<p class="mb-4 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">Explore the sample studio. Saving, uploads and order submission are disabled; figures and orders are illustrative.</p>{/if}{@render children()}</div>
  </div>
{:else}
  {@render children()}
{/if}
