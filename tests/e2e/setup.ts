// Generates the fixture pages' media before any browser test runs: source
// images drawn here, then processed by the built @medkitjs/core into
// examples/html/media/, which is git-ignored. Run `pnpm build` first.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { processImage } from '@medkitjs/core';

export const MEDIA = resolve(import.meta.dirname, '../../examples/html/media');

/** A diagonal two-colour gradient, so encodes and placeholders look like a photo's, not a flat fill. */
function gradient(width: number, height: number, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg));
}

export default async function setup() {
  const src = await mkdtemp(join(tmpdir(), 'medkit-fixture-'));
  try {
    const sources: [string, Sharp][] = [
      ['hero.jpg', gradient(2400, 1350, '#1d2433', '#c2410c').jpeg()],
      ['hero-portrait.jpg', gradient(800, 1000, '#0f766e', '#1d2433').jpeg()],
      ['gallery-1.jpg', gradient(1200, 800, '#334155', '#a16207').jpeg()],
      ['gallery-2.jpg', gradient(1200, 800, '#7c2d12', '#0e7490').jpeg()],
      ['gallery-3.jpg', gradient(1200, 800, '#4d7c0f', '#1e3a8a').jpeg()],
      ['logo.png', sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png()],
    ];
    await Promise.all(sources.map(([name, image]) => image.toFile(join(src, name))));
    await Promise.all(sources.map(([name]) => processImage(join(src, name), { outDir: MEDIA })));
  } finally {
    await rm(src, { recursive: true, force: true });
  }
}
