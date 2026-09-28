import { untrack } from 'svelte';

export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'success'; }
let seq = 0;
export const toasts = $state<{ list: Toast[] }>({ list: [] });
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500): void {
  const id = ++seq;
  // A notification is an imperative side effect. Callers such as form-result
  // effects must not subscribe to this queue and replay when it changes.
  untrack(() => { toasts.list.push({ id, text, kind }); });
  setTimeout(() => { toasts.list = toasts.list.filter((t) => t.id !== id); }, ms);
}
