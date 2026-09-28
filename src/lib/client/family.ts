export type FamilyState = {
  pins: string[];
  seen: Record<string, number[]>;
  positions: Record<string, { y: number; photoId: number | null }>;
};
const empty = (): FamilyState => ({ pins: [], seen: {}, positions: {} });
const key = (eventId: number) => `pk_family_${eventId}`;
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const collectionId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

export function loadFamily(eventId: number): FamilyState {
  try {
    const data = JSON.parse(localStorage.getItem(key(eventId)) ?? 'null');
    if (data?.version !== 1) return empty();
    const state = empty();
    state.pins = Array.isArray(data.pins) ? [...new Set<string>(data.pins.filter(collectionId))].slice(0,20) : [];
    state.seen = Object.fromEntries(Object.entries(data.seen ?? {}).filter(([id, ids]) => collectionId(id) && Array.isArray(ids)).slice(-200)
      .map(([id, ids]) => [id, (ids as unknown[]).filter(positiveId).slice(0,10000)]));
    for (const [path, value] of Object.entries(data.positions ?? {}).slice(-100)) {
      if (!path.startsWith('/g/') || path.length >= 2000 || !value || typeof value !== 'object') continue;
      const position = value as { y?: unknown; photoId?: unknown };
      if (typeof position.y !== 'number' || !Number.isFinite(position.y) || position.y < 0) continue;
      state.positions[path] = { y: Math.min(position.y, 100_000_000), photoId: positiveId(position.photoId) ? position.photoId : null };
    }
    return state;
  } catch { return empty(); }
}

/** Reread immediately before mutation so another tab's visit does not erase saved pins. */
export function saveFamily(eventId: number, update: (state: FamilyState) => void): FamilyState {
  const state = loadFamily(eventId);
  update(state);
  state.pins = state.pins.slice(0,20);
  state.positions = Object.fromEntries(Object.entries(state.positions).slice(-100));
  localStorage.setItem(key(eventId), JSON.stringify({ version: 1, ...state }));
  return state;
}

export function newPhotoCount(state: FamilyState, pid: string, ids: number[]) {
  const seen = state.seen[pid];
  return Array.isArray(seen) ? ids.filter(id => !seen.includes(id)).length : 0;
}
