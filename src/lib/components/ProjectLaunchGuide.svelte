<script lang="ts">
  import type { projectLaunch } from '$shared/project-launch';
  let { guide, eventId, onopen }: { guide: ReturnType<typeof projectLaunch>; eventId: number; onopen: (panel: 'photos'|'settings'|'sharing') => void } = $props();
</script>
<details class="mt-4 rounded-xl border border-stone-200 bg-white" open={guide.completed < 2}>
  <summary class="cursor-pointer px-4 py-3 text-sm font-medium">First delivery guide <span class="font-normal text-stone-500">· {guide.completed} of {guide.steps.length} setup checks satisfied</span></summary>
  <div class="border-t border-stone-100 p-4">
    <ol class="grid gap-4 sm:grid-cols-2">
      {#each guide.steps as step (step.key)}
        <li class="rounded-lg bg-stone-50 p-3">
          <h2 class="text-sm font-semibold"><span class={step.done ? 'text-emerald-700' : 'text-amber-800'}>{step.done ? '✓' : '○'}</span> {step.title}<span class="sr-only"> — {step.done ? 'satisfied' : 'needs attention'}</span></h2>
          <p class="mt-1 text-sm text-stone-600">{step.detail}</p>
          {#if step.target === 'upload'}<a class="mt-2 inline-block text-sm underline" href={`/admin/events/${eventId}/upload`}>{step.action}</a>
          {:else}<button type="button" class="mt-2 text-sm underline" onclick={() => onopen(step.target)}>{step.action}</button>{/if}
        </li>
      {/each}
    </ol>
    <p class="mt-4 text-sm text-stone-600">Before sending a link, open the intended guest link in a private browser window and try a photo and any enabled download. These checks do not confirm recipient access or delivery. Nothing is published or sent by this guide.</p>
  </div>
</details>
