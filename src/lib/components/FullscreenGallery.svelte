<script lang="ts">
  import { onMount } from 'svelte';
  import type PhotoSwipe from 'photoswipe';
  import 'photoswipe/style.css';
  import { photoUrl, photoShareUrl, sharePhoto, type PhotoPresentation } from '$lib/client/photos';
  import BottomSheet from './BottomSheet.svelte';

  let { photos, photo, slug, favorite, onselect, onclose, onfavorite, ondownload }: {
    photos: PhotoPresentation[]; photo: PhotoPresentation; slug: string; favorite: boolean;
    onselect?: (id: number) => void; onclose: () => void;
    onfavorite?: () => void; ondownload?: () => void;
  } = $props();
  let viewer = $state.raw<PhotoSwipe | null>(null);
  let loadError = $state(false);
  let favoriteButton: HTMLButtonElement | undefined;

  $effect(() => {
    if (!viewer) return;
    const index = photos.findIndex(p => p.id === photo.id);
    if (index >= 0 && viewer.currIndex !== index) viewer.goTo(index);
    if (favoriteButton) {
      favoriteButton.textContent = favorite ? '♥ Saved' : '♡ Favorite';
      favoriteButton.setAttribute('aria-pressed', String(favorite));
    }
  });

  onMount(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    let disposed = false;
    let destroyed = false;
    let instance: PhotoSwipe | undefined;
    let restoreScroll: (() => void) | undefined;
    const releaseScroll = () => { restoreScroll?.(); restoreScroll = undefined; };
    // Keep one immutable displayed set for this viewer. The parent remounts it
    // when a filter/favorite removes a photo; swiping never broadens that set.
    const items = [...photos];
    void import('photoswipe').then(({ default: PhotoSwipe }) => {
      if (disposed) return;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      instance = new PhotoSwipe({
        dataSource: items.map(p => {
          // Web renditions preserve composition and fit inside 2560px. Never
          // load a full-resolution download merely to open or zoom a preview.
          const width = p.width || 1600, height = p.height || 1200;
          const scale = Math.min(1, 2560 / Math.max(width, height));
          return { src: photoUrl(p, 'web'), msrc: photoUrl(p, 'thumb'), width: Math.round(width * scale), height: Math.round(height * scale), alt: 'Enlarged preview' };
        }),
        index: Math.max(0, items.findIndex(p => p.id === photo.id)),
        mainClass: 'gatherframe-viewer', bgOpacity: 1, loop: true,
        showHideAnimationType: 'fade', showAnimationDuration: reducedMotion ? 0 : 180,
        hideAnimationDuration: reducedMotion ? 0 : 180, zoomAnimationDuration: reducedMotion ? 0 : 180,
        paddingFn: size => ({ top: size.y < 500 ? 52 : 72, bottom: size.y < 500 ? 72 : 112, left: 0, right: 0 }),
        preload: [1, 1], indexIndicatorSep: ' of ',
        closeTitle: 'Close photo preview', zoomTitle: 'Zoom photo', arrowPrevTitle: 'Previous photo', arrowNextTitle: 'Next photo',
        clickToCloseNonZoomable: false, imageClickAction: 'toggle-controls', tapAction: 'toggle-controls',
        doubleTapAction: 'zoom', closeOnVerticalDrag: true, pinchToClose: false,
        errorMsg: 'This preview could not load. Use Retry photo or close and try again.'
      });
      const pswp = instance;
      pswp.on('uiElementCreate', ({ data }) => {
        if (data.name === 'close') data.onClick = () => { if (pswp.opener.isOpening) onclose(); else pswp.close(); };
      });
      pswp.on('uiRegister', () => {
        pswp.ui?.registerElement({ name: 'photo-actions', appendTo: 'root', onInit: element => {
          element.setAttribute('aria-label', 'Photo actions');
          const button = (label: string, action: () => void) => {
            const node = document.createElement('button');
            node.type = 'button'; node.textContent = label; node.onclick = action;
            element.append(node); return node;
          };
          if (onfavorite) favoriteButton = button(favorite ? '♥ Saved' : '♡ Favorite', () => onfavorite?.());
          button('Share', () => { const current = items[pswp.currIndex]; if (current) void sharePhoto(current, slug); });
          if (ondownload) {
            const download = button('Download', () => ondownload?.());
            download.classList.add('viewer-download'); download.setAttribute('aria-label', 'Download photo');
          }
        }});
        pswp.ui?.registerElement({ name: 'retry', isButton: true, html: 'Retry photo', ariaLabel: 'Retry photo', order: 8,
          onInit: element => {
            element.hidden = true;
            pswp.on('loadComplete', () => { element.hidden = !pswp.currSlide?.content.isError(); });
            pswp.on('change', () => { element.hidden = !pswp.currSlide?.content.isError(); });
          }, onClick: () => pswp.refreshSlideContent(pswp.currIndex)
        });
      });
      pswp.on('change', () => {
        if (disposed) return;
        const current = items[pswp.currIndex];
        if (current) { pswp.element?.setAttribute('data-photo-id', String(current.id)); onselect?.(current.id); }
      });
      pswp.on('afterInit', () => {
        pswp.element?.setAttribute('aria-label', 'Photo preview');
        pswp.element?.setAttribute('aria-modal', 'true');
        const counter = pswp.element?.querySelector('.pswp__counter');
        counter?.setAttribute('role', 'status'); counter?.setAttribute('aria-live', 'polite'); counter?.setAttribute('aria-atomic', 'true');
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        restoreScroll = () => { document.body.style.overflow = overflow; };
        // PhotoSwipe binds its document keyboard handler after the opening
        // animation. Escape must also work during that first fraction of a second.
        pswp.element?.addEventListener('keydown', event => {
          if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault(); event.stopPropagation();
          if (pswp.opener.isOpening) onclose(); else pswp.close();
        });
        // Keyboard users can always bring hidden controls back into view.
        pswp.element?.addEventListener('focusin', () => pswp.element?.classList.add('pswp--ui-visible'));
        pswp.element?.focus({ preventScroll: true });
      });
      pswp.on('destroy', () => { destroyed = true; releaseScroll(); if (!disposed) onclose(); });
      pswp.init();
      viewer = pswp;
    }).catch(() => { if (!disposed) loadError = true; });
    return () => {
      disposed = true;
      releaseScroll();
      const pswp = instance;
      if (!pswp || destroyed) return;
      // PhotoSwipe ignores close/destroy during its opening animation. Rapid
      // favorite removal or route changes must not orphan a full-screen layer.
      if (pswp.opener.isOpening) {
        if (pswp.element) pswp.element.style.display = 'none';
        pswp.options.returnFocus = false;
        pswp.on('openingAnimationEnd', () => {
          pswp.destroy();
          if (previousFocus?.isConnected && !document.querySelector('.gatherframe-viewer, dialog[open]')) previousFocus.focus({ preventScroll: true });
        });
      } else pswp.destroy();
    };
  });
</script>

{#if loadError}
  <BottomSheet open title="Photo preview" {onclose} centered>
    <p role="alert">The full-screen viewer could not load.</p>
    <a class="button-primary mt-4" href={photoUrl(photo, 'web')} target="_blank" rel="noopener">Open photo</a>
    <a class="button-quiet" href={photoShareUrl(photo, slug)}>Photo link</a>
  </BottomSheet>
{/if}

<style>
  :global(.gatherframe-viewer) { --pswp-bg: #111715; --pswp-icon-color: #fff; --pswp-icon-color-secondary: #111715; z-index: 10000; }
  :global(.gatherframe-viewer .pswp__top-bar) { top: env(safe-area-inset-top, 0px); padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px); }
  :global(.gatherframe-viewer .pswp__counter) { font-size: 1rem; opacity: 1; margin-left: 1rem; }
  :global(.gatherframe-viewer.pswp--one-slide .pswp__counter) { display: block; }
  :global(.gatherframe-viewer .pswp__button) { min-width: 48px; min-height: 48px; }
  :global(.gatherframe-viewer .pswp__button--retry) { width: auto; color: white; font-size: .875rem; padding: 0 .75rem; }
  :global(.gatherframe-viewer .pswp__button--retry[hidden]) { display: none; }
  :global(.gatherframe-viewer .pswp__photo-actions) { position: absolute; bottom: 0; left: 0; width: 100%; display: flex; justify-content: center; gap: .5rem; padding: 1rem max(.75rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(.75rem, env(safe-area-inset-left)); background: linear-gradient(transparent, #111715 35%); transition: opacity .18s; opacity: 0; pointer-events: none; }
  :global(.gatherframe-viewer.pswp--ui-visible .pswp__photo-actions) { opacity: 1; pointer-events: auto; }
  :global(.gatherframe-viewer .pswp__photo-actions button) { min-height: 48px; padding: .7rem .9rem; border-radius: .6rem; background: #29332f; color: #fff; font-size: .9375rem; font-weight: 600; white-space: nowrap; }
  :global(.gatherframe-viewer .pswp__photo-actions button[aria-pressed="true"]) { color: #f3ca79; }
  :global(.gatherframe-viewer .pswp__photo-actions .viewer-download) { background: #faf8f3; color: #203e35; }
  :global(.gatherframe-viewer :focus-visible) { outline-color: #f3ca79; }
  @media (max-width: 360px) { :global(.gatherframe-viewer .pswp__photo-actions button) { padding-inline: .65rem; font-size: .875rem; } }
  @media (max-height: 500px) { :global(.gatherframe-viewer .pswp__photo-actions) { padding-top: .4rem; padding-bottom: max(.5rem, env(safe-area-inset-bottom)); } }
</style>
