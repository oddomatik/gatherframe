export class ApiError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }

export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json); }
  const res = await fetch(url, { ...init, headers, body, credentials: 'same-origin' });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string; message?: string })?.error ?? (data as { message?: string })?.message ?? res.statusText, data);
  return data as T;
}

export function thumbUrl(photoId: number, hash: string | null, kind: 'thumb' | 'preview' | 'web' = 'thumb'): string {
  return `/media/${photoId}/${kind}${hash ? `?v=${hash}` : ''}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /\b(FBAN|FBAV|Instagram|Messenger|Line\/|Snapchat|TikTok|MicroMessenger)\b/i.test(navigator.userAgent);
}

/** Trigger a download by navigating a hidden anchor. Works on iOS Safari where blob downloads do not. */
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url; a.rel = 'external noopener'; a.setAttribute('data-sveltekit-reload', ''); a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => a.remove(), 2000);
}
