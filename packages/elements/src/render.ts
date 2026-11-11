// Server-side rendering for <medkit-image>: pure functions from a manifest to
// HTML, with no DOM and no sharp, for any template language.
//
// Threat model: manifests are trusted build output. Every value is still
// escaped for the attribute it lands in, so a quote or ampersand in `alt`,
// `sizes` or a path cannot end the attribute. Values are not validated against
// the schema here; the elements never validate manifests at runtime.

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

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

type Attrs = Record<string, string | number | undefined>;

function tag(name: string, attrs: Attrs): string {
  let html = `<${name}`;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) html += ` ${key}="${escapeAttr(String(value))}"`;
  }
  return html + '>';
}

function read(manifest: ImageManifest): ImageManifest {
  if (manifest.v !== 1) {
    throw new Error(`medkit: manifest "${manifest.id}" has format version ${manifest.v}; this version of medkit reads only 1`);
  }
  return manifest;
}

const srcset = (list: Rendition[], baseUrl: string) => list.map((r) => `${baseUrl}${r.src} ${r.width}w`).join(', ');

/** The `<picture>` that goes inside `<medkit-image>`; renderImage() wraps it. */
export function renderPicture(manifest: ImageManifest, options: RenderImageOptions): string {
  if (typeof options.alt !== 'string') {
    throw new Error(`medkit: image "${manifest.id}" needs alt; pass alt: '' if it is decorative`);
  }
  const main = read(manifest);
  const { sizes = '100vw', priority, fit = 'cover', position = 'center', baseUrl = '/media/', art = [] } = options;
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
      html += tag('source', { media, type, srcset: srcset(m[key], baseUrl), sizes, width: m.width, height: m.height });
    }
  }
  html += tag('source', { type: 'image/avif', srcset: srcset(main.avif, baseUrl), sizes });
  html += tag('source', { type: 'image/webp', srcset: srcset(main.webp, baseUrl), sizes });
  const fallback = main.jpeg.filter((r) => r.width <= 1280).at(-1) ?? main.jpeg[0];
  html += tag('img', {
    src: baseUrl + fallback.src,
    srcset: srcset(main.jpeg, baseUrl),
    sizes,
    width: main.width,
    height: main.height,
    alt: options.alt,
    loading: priority ? 'eager' : 'lazy',
    fetchpriority: priority ? 'high' : undefined,
    decoding: 'async',
    style: `display:block;width:100%;height:auto;object-fit:${fit};object-position:${position}`,
  });
  return html + '</picture>';
}

/** The finished `<medkit-image>`, which shows the image with or without JavaScript. */
export function renderImage(manifest: ImageManifest, options: RenderImageOptions): string {
  return `<medkit-image${options.priority ? ' priority=""' : ''}>${renderPicture(manifest, options)}</medkit-image>`;
}

/**
 * `<link rel="preload">` tags for the `<head>`, so the browser starts fetching
 * the hero before it parses the body. One per crop, each limited by `media` to
 * where its `<source>` would win, so no device preloads a crop it will not show.
 */
export function preloadTags(manifest: ImageManifest, options: Pick<RenderImageOptions, 'sizes' | 'baseUrl' | 'art'> = {}): string {
  const { sizes = '100vw', baseUrl = '/media/', art = [] } = options;
  const not = (media: string) => `(not (${media}))`;
  const crops = [...art, { media: undefined, manifest }];
  return crops
    .map(({ media, manifest: m }, i) => {
      const earlier = art.slice(0, i).map((a) => not(a.media));
      const condition = [...(media ? [`(${media})`] : []), ...earlier].join(' and ') || undefined;
      return tag('link', {
        rel: 'preload',
        as: 'image',
        type: 'image/avif',
        imagesrcset: srcset(read(m).avif, baseUrl),
        imagesizes: sizes,
        media: condition,
        fetchpriority: 'high',
      });
    })
    .join('\n');
}
