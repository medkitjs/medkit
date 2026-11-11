import { checkCss, fallback, imgStyle, srcset, tag } from './html.js';
import { DEFAULT_WIDTHS, pickWidths } from './widths.js';

/** Turns a source path, width and optional quality into a CDN URL. Without a quality, the CDN picks one. */
export type Loader = (src: string, options: { width: number; quality?: number }) => string;

export interface CdnImageOptions {
  loader: Loader;
  alt: string;
  /** Intrinsic size; required, because there is no manifest to read it from. */
  width: number;
  height: number;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  /** Shown behind the image; a priority image uses only this, never the blurred CDN image. */
  color?: string;
  placeholder?: 'blur' | 'color' | 'none';
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  position?: string;
}

const BLUR_WIDTH = 24;

/** The `<picture>` for a CDN image: one srcset, because the CDN picks AVIF or WebP from the request. */
export function renderCdnPicture(src: string, options: CdnImageOptions): string {
  const { loader, alt, width, height, sizes = '100vw', priority, quality, color, fit = 'cover', position = 'center' } = options;
  if (typeof alt !== 'string') throw new Error(`medkit: image "${src}" needs alt; pass alt: '' if it is decorative`);
  if (!(width > 0 && height > 0)) throw new Error(`medkit: CDN image "${src}" needs its width and height`);
  checkCss(fit, color);

  const candidates = cdnCandidates(src, options);
  const placeholder = options.placeholder ?? 'blur';
  const backgrounds: string[] = [];
  // A priority image skips the blurred CDN image: one more request in the
  // critical path would compete with the hero itself.
  if (placeholder === 'blur' && !priority) {
    const size = fit === 'contain' ? 'contain' : fit === 'fill' ? '100% 100%' : 'cover';
    // A quote, backslash or newline in the URL would end the CSS string; each becomes a CSS hex escape.
    const url = loader(src, { width: BLUR_WIDTH }).replace(/[\\"\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
    backgrounds.push(`url("${url}") ${position}/${size} no-repeat`);
  }
  if (placeholder !== 'none' && color) backgrounds.push(color);

  return (
    tag('picture', { style: `display:block${backgrounds.length ? `;background:${backgrounds.join(' ')}` : ''}` }) +
    tag('img', {
      src: fallback(candidates).url,
      srcset: srcset(candidates),
      sizes,
      width,
      height,
      alt,
      loading: priority ? 'eager' : 'lazy',
      fetchpriority: priority ? 'high' : undefined,
      decoding: 'async',
      // The CDN rounds each file's height, and with only width/height
      // attributes the loaded file's ratio would replace the declared one.
      // There is no art direction here, so a fixed ratio is safe.
      style: `${imgStyle(fit, position)};aspect-ratio:${width}/${height}`,
    }) +
    '</picture>'
  );
}

export function cdnCandidates(src: string, { loader, width, quality }: Pick<CdnImageOptions, 'loader' | 'width' | 'quality'>) {
  return pickWidths(DEFAULT_WIDTHS, width).map((w) => ({ url: loader(src, { width: w, quality }), width: w }));
}
