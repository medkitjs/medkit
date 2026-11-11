/**
 * Enhances the `<picture>` that renderImage() put inside it. The image already
 * shows without this class; it only fades the image in over the placeholder and
 * removes the placeholder once the image has loaded, so it cannot show through
 * a transparent image.
 */
export class MedkitImage extends HTMLElement {
  connectedCallback() {
    const img = this.querySelector('img');
    if (!img) return;
    const clear = () => {
      this.style.background = 'none';
    };
    if (img.complete && img.naturalWidth) return clear();

    // A priority image is never hidden: Chromium does not count an image at
    // opacity 0 as the largest paint, so a fade would delay the hero's LCP.
    const fade = !img.complete && !this.hasAttribute('priority') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The transition is only added on load: added now, it would fade the
    // image out from its server-rendered opacity of 1.
    if (fade) img.style.opacity = '0';
    img.addEventListener(
      'load',
      () => {
        if (fade) img.style.transition = 'opacity .3s';
        img.style.removeProperty('opacity');
        if (fade) img.addEventListener('transitionend', clear, { once: true });
        else clear();
      },
      { once: true },
    );
    // A broken image must become visible again, or its alt text stays hidden.
    img.addEventListener('error', () => img.style.removeProperty('opacity'), { once: true });
  }
}
