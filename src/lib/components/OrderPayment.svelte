<script lang="ts">
  import { onMount } from 'svelte';
  import { isInAppBrowser } from '$lib/client/api';
  import { formatCents } from '$shared/money';

  let { due, paid, currency, orderNumber, venmo, instructions }: {
    due: number; paid: number; currency: string; orderNumber: string;
    venmo: { handle: string; https: string; app: string } | null;
    instructions: string;
  } = $props();
  let helpOpen = $state(false);
  let copyStatus = $state('');
  onMount(() => { helpOpen = isInAppBrowser(); });
  const handle = $derived(venmo?.handle.trim().replace(/^@/, '') ?? '');
  const details = $derived(`@${handle} · ${formatCents(due, currency)} · ${orderNumber}`);
  async function copyDetails() {
    try { await navigator.clipboard.writeText(details); copyStatus = 'Payment details copied.'; }
    catch { copyStatus = 'Select the payment details above to copy them.'; }
  }
</script>

<section aria-label="Payment options" class="mt-6 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-lg font-semibold">Payment</h2>
    <p class="font-semibold">{formatCents(due, currency)} due</p>
  </div>
  {#if paid > 0}<p class="mt-1 text-sm text-stone-600">{formatCents(paid, currency)} recorded as paid</p>{/if}
  <div class="mt-4 grid gap-3 sm:grid-cols-2">
    <div class="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
      <h3 class="font-semibold text-emerald-950">Pay cash in person</h3>
      <p class="mt-2 text-sm text-emerald-900">Your order is saved. Pay {formatCents(due, currency)} to the photographer in person.</p>
      <p class="mt-2 text-sm text-emerald-900">Order <strong>{orderNumber}</strong></p>
    </div>
    {#if venmo}
      <div class="rounded-xl border border-sky-200 bg-sky-50 p-4">
        <h3 class="font-semibold text-sky-950">Venmo</h3>
        <!-- Real external links work before hydration and retain the user's tap.
             No device-dependent destination, async navigation, or redirect timer. -->
        <a href={venmo.https} rel="external noreferrer" data-sveltekit-reload class="mt-3 block rounded-xl bg-[#0074CC] px-4 py-3 text-center font-semibold text-white">Pay with Venmo</a>
        <a href={venmo.app} rel="external noreferrer" data-sveltekit-reload class="mt-1 flex min-h-11 items-center justify-center text-sm font-medium text-sky-900 underline">Open Venmo app</a>
        <p class="break-words text-sm text-sky-950">@{handle}</p>
        <p class="mt-1 text-sm text-sky-900">Include <strong>{orderNumber}</strong></p>
      </div>
    {/if}
  </div>
  {#if instructions}<p class="mt-4 whitespace-pre-line text-sm text-stone-600">{instructions}</p>{/if}
  {#if venmo}
    <details class="mt-3 text-sm" bind:open={helpOpen}>
      <summary class="cursor-pointer py-2 font-medium text-stone-700">Venmo didn’t open?</summary>
      <p class="mt-1 text-stone-600">Open this page in Safari or Chrome, or open Venmo and use these details:</p>
      <label class="mt-2 block text-xs text-stone-600">Payment details
        <input readonly value={details} onclick={e => e.currentTarget.select()} class="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-900" />
      </label>
      <button type="button" class="button-secondary mt-2" onclick={copyDetails}>Copy payment details</button>
      <p role="status" class="mt-1 text-xs text-stone-600">{copyStatus}</p>
    </details>
  {/if}
  <p class="mt-3 text-xs text-stone-500">The photographer records payments. Your balance may take a little time to update.</p>
</section>
