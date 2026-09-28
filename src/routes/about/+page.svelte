<script lang="ts">
  import license from '../../../LICENSE?raw';
  import pkg from '../../../package.json';
</script>

<svelte:head><title>About Gatherframe</title><meta name="robots" content="noindex" /></svelte:head>
<main class="mx-auto max-w-3xl px-6 py-12">
  <h1 class="text-3xl font-semibold">Gatherframe</h1>
  <p class="mt-4">Version {pkg.version} · Copyright 2026 Gatherframe contributors.</p>
  <p class="mt-4">Free software under the GNU Affero General Public License version 3. Provided without warranty.</p>
  <p class="mt-4"><a class="underline" href="/source.tgz" download>Download this build’s source code</a></p>
  <p class="mt-2 text-sm">Includes application code and build instructions. Photos, customer records and server configuration are not included.</p>
  <details class="mt-8"><summary class="cursor-pointer">Read the license</summary><pre class="mt-4 whitespace-pre-wrap text-xs">{license}</pre></details>
</main>
