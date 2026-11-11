// Server-side rendering for <medkit-image>: pure functions from a manifest, or
// a CDN source path and loader, to HTML, with no DOM and no sharp.
//
// Threat model: manifests and options are the developer's own build output and
// code. Every value is still escaped for the attribute it lands in, so a quote
// or ampersand in `alt`, `sizes` or a path cannot end the attribute. Values are
// not validated against the schema here; the elements never validate manifests
// at runtime.

import { cdnCandidates, renderCdnPicture, type CdnImageOptions } from './cdn.js';
import { fallback, imgStyle, srcset, tag } from './html.js';
import type { ImageManifest, Rendition } from './manifest.js';

export interface ArtSource {
  /** A media condition, such as `(max-width: 640px)`; not a media type like `screen`. */
  media: string;
  manifest: ImageManifest;
}

export interface RenderImageOptions {
  /** Required; pass `''` for a decorative image. */
  alt: string;
  /** Default `100vw`. */
  sizes?: string;
  /** Eager loading, `fetchpriority="high"`, and no fade, for the hero image. */
  priority?: boolean;
  /** Default `blur`; falls back to `color` when the manifest has no blur. */
  placeholder?: 'blur' | 'color' | 'none';
  /** `object-fit`; default `cover`. */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** `object-position`; default `center`. */
  position?: string;
  /** Where the files are served from, ending in `/`; default `/media/`. */
  baseUrl?: string;
  /** Other crops, checked in order before the main image. */
  art?: ArtSource[];
}

function read(manifest: ImageManifest): ImageManifest {
  if (manifest.v !== 1) {
    throw new Error(`medkit: manifest "${manifest.id}" has format version ${manifest.v}; this version of medkit reads only 1`);
  }
  return manifest;
}

const urls = (list: Rendition[], baseUrl: string) => list.map((r) => ({ url: baseUrl + r.src, width: r.width }));

/** The `<picture>` that goes inside `<medkit-image>`; renderImage() wraps it. */
export function renderPicture(manifest: ImageManifest, options: RenderImageOptions): string;
export function renderPicture(src: string, options: CdnImageOptions): string;
export function renderPicture(source: ImageManifest | string, options: RenderImageOptions | CdnImageOptions): string {
  if (typeof source === 'string') return renderCdnPicture(source, options as CdnImageOptions);
  const main = read(source);
  const { alt, sizes = '100vw', priority, fit = 'cover', position = 'center', baseUrl = '/media/', art = [] } = options as RenderImageOptions;
  if (typeof alt !== 'string') throw new Error(`medkit: image "${main.id}" needs alt; pass alt: '' if it is decorative`);
  const placeholder = options.placeholder ?? 'blur';

  let background: string | undefined;
  if (placeholder === 'blur' && main.placeholder) {
    const size = fit === 'contain' ? 'contain' : fit === 'fill' ? '100% 100%' : 'cover';
    background = `background:${main.color} url(${main.placeholder}) ${position}/${size} no-repeat`;
  } else if (placeholder !== 'none') {
    background = `background:${main.color}`;
  }

  let html = tag('picture', { style: `display:block${background ? `;${background}` : ''}` });
  for (const { media, manifest: crop } of art) {
    const m = read(crop);
    for (const [key, type] of [['avif', 'image/avif'], ['webp', 'image/webp'], ['jpeg', 'image/jpeg']] as const) {
      html += tag('source', { media, type, srcset: srcset(urls(m[key], baseUrl)), sizes, width: m.width, height: m.height });
    }
  }
  html += tag('source', { type: 'image/avif', srcset: srcset(urls(main.avif, baseUrl)), sizes });
  html += tag('source', { type: 'image/webp', srcset: srcset(urls(main.webp, baseUrl)), sizes });
  const jpeg = urls(main.jpeg, baseUrl);
  html += tag('img', {
    src: fallback(jpeg).url,
    srcset: srcset(jpeg),
    sizes,
    width: main.width,
    height: main.height,
    alt,
    loading: priority ? 'eager' : 'lazy',
    fetchpriority: priority ? 'high' : undefined,
    decoding: 'async',
    style: imgStyle(fit, position),
  });
  return html + '</picture>';
}

/**
 * The finished `<medkit-image>`, which shows the image with or without
 * JavaScript: from a manifest for local images, or from a source path and a
 * `loader` for a CDN.
 */
export function renderImage(manifest: ImageManifest, options: RenderImageOptions): string;
export function renderImage(src: string, options: CdnImageOptions): string;
export function renderImage(source: ImageManifest | string, options: RenderImageOptions | CdnImageOptions): string {
  const picture = renderPicture(source as ImageManifest, options as RenderImageOptions);
  return `<medkit-image${options.priority ? ' priority=""' : ''}>${picture}</medkit-image>`;
}

/**
 * `<link rel="preload">` tags for the `<head>`, so the browser starts fetching
 * the hero before it parses the body. For a manifest, one AVIF link per crop,
 * each limited by `media` to where its `<source>` would win, so no device
 * preloads a crop it will not show. For a CDN image, one link with the same
 * srcset the `<img>` gets.
 */
export function preloadTags(manifest: ImageManifest, options?: Pick<RenderImageOptions, 'sizes' | 'baseUrl' | 'art'>): string;
export function preloadTags(src: string, options: Pick<CdnImageOptions, 'loader' | 'width' | 'quality' | 'sizes'>): string;
export function preloadTags(
  source: ImageManifest | string,
  options: Pick<RenderImageOptions, 'sizes' | 'baseUrl' | 'art'> | Pick<CdnImageOptions, 'loader' | 'width' | 'quality' | 'sizes'> = {},
): string {
  const sizes = options.sizes ?? '100vw';
  const link = (attrs: Record<string, string | undefined>) =>
    tag('link', { rel: 'preload', as: 'image', ...attrs, imagesizes: sizes, fetchpriority: 'high' });

  if (typeof source === 'string') {
    return link({ imagesrcset: srcset(cdnCandidates(source, options as CdnImageOptions)) });
  }
  const { baseUrl = '/media/', art = [] } = options as RenderImageOptions;
  const not = (media: string) => `(not (${media}))`;
  return [...art, { media: undefined, manifest: source }]
    .map(({ media, manifest }, i) => {
      const earlier = art.slice(0, i).map((a) => not(a.media));
      const condition = [...(media ? [`(${media})`] : []), ...earlier].join(' and ') || undefined;
      return link({ type: 'image/avif', imagesrcset: srcset(urls(read(manifest).avif, baseUrl)), media: condition });
    })
    .join('\n');
}
