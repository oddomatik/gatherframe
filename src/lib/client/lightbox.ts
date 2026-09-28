import 'photoswipe/style.css';

/** Svelte action: attach a PhotoSwipe lightbox to a container whose children are <a href=web data-pswp-width data-pswp-height>. */
export function lightbox(node: HTMLElement, opts: { onOpen?: (index: number) => void } = {}) {
  let instance: { init: () => void; destroy: () => void } | null = null;
  void import('photoswipe/lightbox').then(async ({ default: PhotoSwipeLightbox }) => {
    instance = new PhotoSwipeLightbox({
      gallery: node, children: 'a.pswp-item', pswpModule: () => import('photoswipe'),
      showHideAnimationType: 'zoom', bgOpacity: 0.95, padding: { top: 12, bottom: 12, left: 8, right: 8 }, wheelToZoom: true
    });
    instance.init();
    if (opts.onOpen) (instance as unknown as { on: (e: string, cb: () => void) => void }).on('change', () => { /* noop */ });
  });
  return { destroy() { instance?.destroy(); } };
}
