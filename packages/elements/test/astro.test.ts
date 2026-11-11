// Covers the Astro component: that it renders exactly what renderImage()
// writes. Runs under Astro's Vite config (vitest.astro.config.ts), and imports
// renderImage through the package's built dist/, so run `pnpm build` first.
//
// Not covered: the markup itself, which render.test.ts covers once for all
// three ways of producing it.

import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Image from '../astro/Image.astro';
import type { ImageManifest } from '../src/manifest.js';
import type { ImageProps } from '../src/render.js';
import { renderImage } from '../src/render.js';

const hero: ImageManifest = {
  v: 1,
  id: 'hero',
  kind: 'image',
  width: 1600,
  height: 900,
  color: '#1d2433',
  avif: [{ src: 'hero-640.avif', width: 640, height: 360, bytes: 1 }],
  webp: [{ src: 'hero-640.webp', width: 640, height: 360, bytes: 1 }],
  jpeg: [{ src: 'hero-640.jpg', width: 640, height: 360, bytes: 1 }],
  hash: 'abc',
};

// Image.astro's Props is ImageProps; these fail `pnpm lint` if it stops
// requiring a manifest and alt.
// @ts-expect-error a manifest is required
const noManifest: ImageProps = { alt: 'x' };
// @ts-expect-error alt is required, '' for a decorative image
const noAlt: ImageProps = { manifest: hero };
void [noManifest, noAlt];

test('the Astro component renders exactly what renderImage() writes', async () => {
  const container = await AstroContainer.create();
  const options = { alt: 'A "quoted" & escaped caption', priority: true };
  const html = await container.renderToString(Image, { props: { manifest: hero, ...options } });
  expect(html.trim()).toBe(renderImage(hero, options));
});
