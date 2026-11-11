// The development build of <medkit-image>: the same element plus console
// warnings. Bundlers pick it through the "development" export condition; plain
// HTML pages load image-dev.js directly. Load one build or the other, never
// both: whichever registers <medkit-image> first wins.

import { MedkitImage } from './image-element.js';

const warn = (message: string, element: Element) => console.warn(`<medkit-image> ${message}`, element);

class MedkitImageDev extends MedkitImage {
  override connectedCallback() {
    const clientRendered = !this.querySelector('img') && this.hasAttribute('src');
    if (clientRendered && !this.getBoundingClientRect().height) {
      warn('renders on the client with no box reserved, so the page shifts; add style="aspect-ratio: <width> / <height>"', this);
    }
    if (clientRendered && !this.hasAttribute('alt')) warn('has no alt; write alt="" if the image is decorative', this);
    super.connectedCallback();
    const img = this.querySelector('img');
    if (!img) {
      if (!clientRendered) warn('has no <img> inside and no src; render it with renderImage()', this);
      return;
    }
    if (!img.hasAttribute('alt')) warn('has no alt; write alt="" if the image is decorative', this);
    if (!img.getAttribute('width') || !img.getAttribute('height')) {
      warn('has no width or height on its <img>, so the page shifts when it loads', this);
    }
    if (img.complete) checkSize(img);
    else img.addEventListener('load', () => checkSize(img), { once: true });
    checkPageOnce();
  }
}

function checkSize(img: HTMLImageElement) {
  // naturalWidth on the <img> is scaled by the srcset density, so the file's
  // real width comes from a second, unscaled decode of the same cached file.
  const file = new Image();
  file.src = img.currentSrc;
  file.decode().then(
    () => {
      const shown = img.clientWidth * devicePixelRatio;
      if (shown && file.naturalWidth > 2 * shown) {
        warn(`downloads a ${file.naturalWidth}px file to show ${Math.round(shown)} device pixels; check sizes`, img.closest('medkit-image')!);
      }
    },
    () => {},
  );
}

let pageChecked = false;
function checkPageOnce() {
  if (pageChecked) return;
  pageChecked = true;
  if (document.readyState === 'complete') checkPage();
  else addEventListener('load', checkPage, { once: true });
}

function checkPage() {
  const priority = document.querySelectorAll('medkit-image[priority]');
  if (priority.length > 1) warn(`appears ${priority.length} times with priority; only the hero image should have it`, priority[1]);
  if (!priority.length) return;

  if (!PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
    console.info('<medkit-image> skipped the largest-paint check: this browser does not report LCP');
    return;
  }
  new PerformanceObserver((list, observer) => {
    observer.disconnect();
    const lcp = list.getEntries().at(-1) as LargestContentfulPaint | undefined;
    if (lcp?.element && !priority[0].contains(lcp.element)) {
      warn('has priority but is not the largest paint on the page; that is', lcp.element);
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
}

if (!customElements.get('medkit-image')) customElements.define('medkit-image', MedkitImageDev);
