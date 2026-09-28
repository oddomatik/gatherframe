import { redirect, type RequestHandler } from '@sveltejs/kit';
import { eventContext } from '$server/guard';
import { tryUnlock } from '$server/access';
import { rateLimit } from '$server/ratelimit';

export const POST: RequestHandler = async (e) => {
  const { event, sid, secure } = eventContext(e);
  const form = await e.request.formData();
  const password = String(form.get('password') ?? '');
  let redirectTo = String(form.get('redirectTo') ?? `/g/${event.slug}`);
  if (!(redirectTo === `/g/${event.slug}` || redirectTo.startsWith(`/g/${event.slug}/`) || redirectTo.startsWith(`/g/${event.slug}?`)) || redirectTo.includes('\\')) redirectTo = `/g/${event.slug}`;
  // Per-visitor limit is tight; the per-event limit is generous so one school Wi-Fi NAT cannot lock everyone out.
  const perVisitor = rateLimit(`unlock:${sid}`, 10, 60_000);
  const perEvent = rateLimit(`unlock:event:${event.id}`, 600, 60_000);
  if (!perVisitor.ok || !perEvent.ok) throw redirect(303, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}unlock=bad`);
  const ok = await tryUnlock(event, password, sid, e.cookies, secure);
  throw redirect(303, ok ? redirectTo : `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}unlock=bad`);
};
