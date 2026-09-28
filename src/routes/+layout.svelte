<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
<footer class="px-4 py-3 text-center text-xs text-stone-500"><a href="/about" class="hover:underline">Gatherframe · source &amp; license</a></footer>
