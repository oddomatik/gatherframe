/** A browsing label, never part of photo identity or collection membership. */
export type ShootDay = 1 | 2;

export function parseShootDay(value: unknown): ShootDay | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === 1 || value === '1') return 1;
  if (value === 2 || value === '2') return 2;
  throw new Error('Choose Day 1, Day 2, or leave the day unlabeled.');
}

/** Unknown URL filters fall back to the complete collection, never hide photos. */
export function readDayFilter(value: unknown): ShootDay | null {
  try { return parseShootDay(value); } catch { return null; }
}

export function dayLabel(day: number): string { return `Day ${day}`; }
