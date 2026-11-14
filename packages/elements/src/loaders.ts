// CDN loaders: each turns a source path, width and optional quality into that
// CDN's URL. Without a quality, the CDN's own automatic choice applies. URL
// shapes were checked against each provider's documentation in November 2026.

import type { Loader } from './cdn.js';
import { pending, registry } from './registry.js';
import type { Labels } from './strings.js';

export type { Loader };

/** Types a custom loader: `defineLoader((src, { width, quality }) => url)`. */
export const defineLoader = (loader: Loader): Loader => loader;

const trim = (s: string) => s.replace(/\/+$/, '');
const path = (src: string) => src.replace(/^\/+/, '');

/** `https://res.cloudinary.com/<cloudName>/image/upload/c_limit,w_640/f_auto/q_auto/<publicId>` */
export const cloudinary = ({ cloudName }: { cloudName: string }) =>
  defineLoader(
    (src, { width, quality }) =>
      `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/c_limit,w_${width}/f_auto/q_${quality ?? 'auto'}/${path(src)}`,
  );

/** `https://<domain>/<path>?w=640&auto=format,compress`; `domain` is the full host, such as `demo.imgix.net`. */
export const imgix = ({ domain }: { domain: string }) =>
  defineLoader(
    (src, { width, quality }) =>
      `https://${trim(domain)}/${path(src)}?w=${width}&auto=format,compress${quality ? `&q=${quality}` : ''}`,
  );

/**
 * `https://<zone>/cdn-cgi/image/width=640,format=auto/<path>`; transformations
 * must be enabled on the zone. `src` is a path on that zone or an absolute URL.
 */
export const cloudflare = ({ zone }: { zone: string }) =>
  defineLoader(
    (src, { width, quality }) =>
      `https://${trim(zone)}/cdn-cgi/image/width=${width},format=auto${quality ? `,quality=${quality}` : ''}/${path(src)}`,
  );

/** `<urlEndpoint>/<path>?tr=w-640,f-auto`; `urlEndpoint` is such as `https://ik.imagekit.io/demo`. */
export const imagekit = ({ urlEndpoint }: { urlEndpoint: string }) =>
  defineLoader(
    (src, { width, quality }) => `${trim(urlEndpoint)}/${path(src)}?tr=w-${width},f-auto${quality ? `,q-${quality}` : ''}`,
  );

/**
 * Sets the loader that client-rendered `<medkit-image src>` elements use: a
 * default, and named ones for a `loader="name"` attribute. Elements already on
 * the page that were waiting for a loader render now. `labels` overrides the
 * English labels of every element; a key it leaves out keeps its default.
 */
export function configure(options: { loader?: Loader; loaders?: Record<string, Loader>; labels?: Labels }): void {
  if (options.loader) registry.loader = options.loader;
  Object.assign(registry.loaders, options.loaders);
  Object.assign(registry.labels, options.labels);
  for (const render of [...pending]) render();
}

/**
 * Labels for elements whose nearest `lang` is `lang`, or starts with it and a
 * hyphen (`sr` covers `sr-Latn`); matched without regard to case. A key it
 * leaves out falls back to configure({ labels }), then English. Elements read
 * labels when they render, so register before they connect.
 */
export function registerLocale(lang: string, labels: Labels): void {
  registry.locales[lang.toLowerCase()] = { ...registry.locales[lang.toLowerCase()], ...labels };
}
