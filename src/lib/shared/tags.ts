/** Project-owned hierarchy. Photo identity and child collections are independent. */
export interface PhotoTag { id: number; publicId: string; parentId: number | null; name: string; shared: boolean; legacyDay?: number | null; }
export function tagDescendants(tags: PhotoTag[], id: number): Set<number> {
  const ids = new Set([id]);
  for (let changed = true; changed;) { changed = false; for (const t of tags) if (t.parentId !== null && ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); changed = true; } }
  return ids;
}
export function tagPath(tags: PhotoTag[], id: number): string {
  const names: string[] = [], seen = new Set<number>();
  let tag = tags.find(t => t.id === id);
  while (tag && !seen.has(tag.id)) { seen.add(tag.id); names.unshift(tag.name); tag = tags.find(t => t.id === tag!.parentId); }
  return names.join(' / ');
}
export function tagTree(tags: PhotoTag[]): PhotoTag[] {
  const result: PhotoTag[] = [], seen = new Set<number>();
  function walk(parent: number | null) { for (const t of tags.filter(t => t.parentId === parent).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}))) { if (seen.has(t.id)) continue; seen.add(t.id); result.push(t); walk(t.id); } }
  walk(null); return result;
}
export function tagIsShared(tags: PhotoTag[], id: number): boolean {
  const seen = new Set<number>(); let tag = tags.find(t => t.id === id);
  while (tag && !seen.has(tag.id)) { if (!tag.shared) return false; seen.add(tag.id); if (tag.parentId === null) return true; tag = tags.find(t => t.id === tag!.parentId); }
  return false;
}
export function matchesTags(tags: PhotoTag[], assigned: number[], chosen: number[], mode: 'any' | 'all' = 'any'): boolean {
  if (!chosen.length) return true;
  const test = (id: number) => assigned.some(n => tagDescendants(tags, id).has(n));
  return mode === 'all' ? chosen.every(test) : chosen.some(test);
}
export function tagQuery(ids: string[], mode: 'any' | 'all' = 'any'): string {
  return ids.length ? '?' + new URLSearchParams({ tags: [...new Set(ids)].sort().join(','), match: mode }).toString() : '';
}
