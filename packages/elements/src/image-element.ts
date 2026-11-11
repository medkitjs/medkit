import { renderCdnPicture, type CdnImageOptions } from './cdn.js';
import { pending, registry } from './registry.js';

/**
 * Enhances the `<picture>` that renderImage() put inside it. The image already
 * shows without this class; it only fades the image in over the placeholder,
 * which is the `<picture>`'s background, and removes the placeholder once the
 * image has loaded, so it cannot show through a transparent image.
 *
 * Only the `<picture>` and `<img>` are touched, never this element's own
 * attributes, so a framework that rendered and hydrates it sees no mismatch.
 *
 * With no `<img>` inside but a `src`, it renders one itself through a CDN
 * loader set with configure(); that path needs no build step, and needs
 * `aspect-ratio` on the element to reserve its box before it renders.
 */
export class MedkitImage extends HTMLElement {
  connectedCallback() {
    if (!this.querySelector('img') && this.hasAttribute('src')) this.renderFromCdn();
    const img = this.querySelector('img');
    if (!img) return;
    const clear = () => {
      img.parentElement!.style.background = 'none';
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

  private renderFromCdn() {
    const attr = (name: string) => this.getAttribute(name) ?? undefined;
    const name = attr('loader');
    const loader = name ? registry.loaders[name] : registry.loader;
    if (!loader) {
      // configure() may run after this element upgrades; it calls this back.
      const retry = () => {
        pending.delete(retry);
        if (this.isConnected) this.connectedCallback();
      };
      pending.add(retry);
      return;
    }
    this.innerHTML = renderCdnPicture(attr('src')!, {
      loader,
      alt: attr('alt')!,
      width: Number(attr('width')),
      height: Number(attr('height')),
      sizes: attr('sizes'),
      quality: attr('quality') ? Number(attr('quality')) : undefined,
      priority: this.hasAttribute('priority'),
      color: attr('color'),
      placeholder: attr('placeholder') as CdnImageOptions['placeholder'],
      fit: attr('fit') as CdnImageOptions['fit'],
      position: attr('position'),
    });
  }
}
