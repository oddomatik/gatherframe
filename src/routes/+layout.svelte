<script lang="ts">
  import '../app.css';
  let { data, children } = $props();
</script>

{#if data.demo}
  <nav class="demo-bar" aria-label="Demo navigation">
    <a href="/" class="demo-brand">Gatherframe <span>demo</span></a>
    <div><a href="/g/field-notes">Gallery</a><a href="/admin">Studio tour</a><a href="https://github.com/oddomatik/gatherframe">Source ↗</a></div>
    <span class="demo-note">Read-only · sample photographs</span>
  </nav>
{/if}
{@render children()}
<footer class="px-4 py-3 text-center text-xs text-stone-500"><a href="/about" class="hover:underline">Gatherframe · source &amp; license</a></footer>

<style>
  .demo-bar { display:flex; align-items:center; justify-content:space-between; gap:.75rem 1.5rem; flex-wrap:wrap; padding:.65rem clamp(1rem,3vw,2.5rem); background:#203e35; color:#faf8f3; font-size:.8125rem; }
  .demo-brand { font-weight:650; letter-spacing:.01em; }.demo-brand span{font-weight:400;opacity:.7;margin-left:.35rem}
  .demo-bar div{display:flex;gap:1.4rem}.demo-bar a{display:inline-flex;align-items:center;min-height:32px}.demo-note{color:#cdd8d0;font-size:.75rem}
  @media(max-width:600px){.demo-bar{gap:.15rem .75rem;padding:.4rem .8rem}.demo-bar div{gap:.9rem}.demo-note{width:100%;padding-bottom:.25rem}.demo-bar a{min-height:40px}}
</style>
