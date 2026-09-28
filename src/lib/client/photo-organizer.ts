/** Private metadata is supplied only by the admin page. These filters never edit
 * collections or publication: the photographer still chooses what to share. */
export interface PrivatePhotoMetadata { rating: number | null; label: string | null; keywords: string[]; title: string | null; description: string | null; }
export interface OrganizerPhoto {
  displayName: string; collections: { name: string }[];
  sidecars: { kind: string; metadata: PrivatePhotoMetadata | null }[];
}
export function lightroomMetadata(photo: OrganizerPhoto): PrivatePhotoMetadata | null {
  return photo.sidecars.find((s) => s.kind === 'xmp')?.metadata ?? null;
}
export function matchesPrivateMetadata(photo: OrganizerPhoto, search: string, ratingFilter: string, exactKeyword: string | null = null): boolean {
  const metadata = lightroomMetadata(photo);
  if (exactKeyword !== null && !metadata?.keywords.includes(exactKeyword)) return false;
  const rating = metadata?.rating;
  if (ratingFilter === 'rejected' && rating !== -1) return false;
  if (ratingFilter === 'unrated' && rating !== null && rating !== undefined && rating !== 0) return false;
  if (['3', '4', '5'].includes(ratingFilter) && (rating ?? 0) < Number(ratingFilter)) return false;
  const text = [photo.displayName, ...photo.collections.map((g) => g.name), ...(metadata?.keywords ?? []), metadata?.label, metadata?.title, metadata?.description].filter(Boolean).join(' ').toLocaleLowerCase();
  return text.includes(search.trim().toLocaleLowerCase());
}
