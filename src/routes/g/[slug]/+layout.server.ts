import { listDeliveryVersions } from '$server/delivery';
import type { LayoutServerLoad } from './$types';
import { eventContext } from '$server/guard';
import { getSettings } from '$server/settings';
import { publicLinkPreview } from '$server/link-preview';
import { env, nowIso } from '$server/env';

export const load: LayoutServerLoad = (e) => {
  const { event, state, isAdmin } = eventContext(e);
  const s = getSettings();
  const preview = publicLinkPreview(event);
  return {
    linkPreview: !event.guestGrant && !event.scopedSharingOnly && event.isPublished && (!event.expiresAt || event.expiresAt > nowIso()) ? {
      ...preview,
      url: env.publicOrigin + e.url.pathname + '?' + new URLSearchParams([
        ...['tags', 'match', 'photo'].flatMap(key => e.url.searchParams.has(key) ? [[key, e.url.searchParams.get(key)!]] : []),
        ['share', preview.revision]
      ]).toString()
    } : null,
    event: { id: event.id, slug: event.slug, name: event.name, tagline: state === 'ok' ? event.tagline : null, parentMessage: state === 'ok' ? event.parentMessage : null, subjectLabel: event.subjectLabel, orderingEnabled: !!event.orderingEnabled, variantPolicy: event.variantPolicy, versions: state === 'ok' ? listDeliveryVersions(event.id).filter(v => event.variantPolicy[v.key] !== 'disabled').map(v => ({ key:v.key, label:v.label })) : [], hasPassword: !!event.passwordHash },
    scopedInvitation: !!event.guestGrant,
    galleryLayout: event.galleryLayout,
    access: state,
    isAdminPreview: isAdmin,
    studio: { name: s.studioName, photographer: s.photographerName, contact: s.contactLine, currency: s.currency },
    unlockError: e.url.searchParams.get('unlock') === 'bad'
  };
};
