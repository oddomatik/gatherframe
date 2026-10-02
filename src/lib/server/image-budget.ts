/** One decode budget shared by browsing, generated delivery and recipe previews. */
let active = 0;
const waiting: (() => void)[] = [];
export async function withImageBudget<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
