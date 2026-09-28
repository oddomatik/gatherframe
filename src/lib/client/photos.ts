import { thumbUrl } from './api';
import { toast } from './toast.svelte';

export interface PhotoPresentation { id: number; hash?: string | null; urls?: { thumb: string; preview: string; web: string }; shareUrl?: string; }
export function photoUrl(photo: PhotoPresentation | undefined, kind: 'thumb' | 'preview' | 'web' = 'thumb'): string {
  return photo?.urls?.[kind] ?? (photo ? thumbUrl(photo.id, photo.hash ?? null, kind) : '');
}
export function photoShareUrl(photo: PhotoPresentation, slug: string): string {
  return photo.shareUrl ?? `/g/${encodeURIComponent(slug)}/p/${photo.id}`;
}
export async function sharePhoto(photo: PhotoPresentation, slug: string): Promise<void> {
  const url = new URL(photoShareUrl(photo, slug), window.location.origin).href;
  try {
    if (navigator.share) await navigator.share({ title: 'A little moment worth keeping', url });
    else { await navigator.clipboard.writeText(url); toast('Photo link copied. Your gallery’s access settings still apply.', 'success'); }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(url); toast('Photo link copied', 'success'); }
    catch { toast('Use the photo’s “Open link” to copy its address.', 'error'); }
  }
}
export function loadFavorites(eventId: number): Set<number> {
  try { const values: unknown = JSON.parse(localStorage.getItem(`pk_favorites_${eventId}`) ?? '[]'); return new Set(Array.isArray(values) ? values.filter((v): v is number => Number.isSafeInteger(v)) : []); }
  catch { return new Set(); }
}
export function saveFavorites(eventId: number, ids: Set<number>): void {
  try { localStorage.setItem(`pk_favorites_${eventId}`, JSON.stringify([...ids])); }
  catch { toast('Favorites are available for this visit, but this browser could not save them.', 'error'); }
}
