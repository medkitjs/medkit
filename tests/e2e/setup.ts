// Generates the fixture media before any browser test runs: source images
// drawn here and source videos generated with ffmpeg, processed by the built
// @medkitjs/core into examples/html/media/, then images rendered with
// renderImage() into examples/html/layout.html. Both are git-ignored. Run
// `pnpm build` first; needs ffmpeg on PATH.
//
// The media folder is emptied first, so a local run sees exactly the files a
// fresh CI checkout gets; a file left from an older pipeline once let a page
// pass locally while it 404'd in CI.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp, { type Sharp } from 'sharp';
import { processImage, processVideo } from '@medkitjs/core';
import { preloadTags, renderImage, type ImageManifest } from '@medkitjs/elements';

export const MEDIA = resolve(import.meta.dirname, '../../examples/html/media');

/** A diagonal two-colour gradient, so encodes and placeholders look like a photo's, not a flat fill. */
function gradient(width: number, height: number, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg));
}

export default async function setup() {
  await rm(MEDIA, { recursive: true, force: true });
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
    const manifests = await Promise.all(sources.map(([name]) => processImage(join(src, name), { outDir: MEDIA })));
    await writeLayoutPage(Object.fromEntries(manifests.map((m) => [m.id, m])));

    // testsrc2 changes every frame and has no all-black frame, so a black
    // frame on screen can only come from the element, never from the clip.
    const clip = (name: string, audio: boolean, seconds = 6) =>
      promisify(execFile)('ffmpeg', [
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
        ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440'] : []),
        '-t', String(seconds), '-pix_fmt', 'yuv420p', join(src, name),
      ]);
    // short-a and short-b are under 5 seconds, so auto-advance tests run quickly.
    await Promise.all([clip('bg.mp4', false), clip('talk.mp4', true), clip('short-a.mp4', false, 2.5), clip('short-b.mp4', false, 2.5)]);
    await Promise.all([
      processVideo(join(src, 'bg.mp4'), { outDir: MEDIA, ladder: [480, 720] }),
      processVideo(join(src, 'talk.mp4'), { outDir: MEDIA, ladder: [480, 720], keepAudio: true }),
      processVideo(join(src, 'short-a.mp4'), { outDir: MEDIA, ladder: [480, 720] }),
      processVideo(join(src, 'short-b.mp4'), { outDir: MEDIA, ladder: [480, 720] }),
    ]);
  } finally {
    await rm(src, { recursive: true, force: true });
  }
}

/**
 * The layout-shift page: a priority hero with an art-directed portrait crop,
 * then lazy images far below the fold, with text after every image so any
 * shift moves something measurable.
 */
async function writeLayoutPage(m: Record<string, ImageManifest>) {
  const baseUrl = '/examples/html/media/';
  const art = [{ media: '(max-width: 640px)', manifest: m['hero-portrait'] }];
  const gallery = ['gallery-1', 'gallery-2', 'gallery-3']
    .map((id, i) => `<figure>${renderImage(m[id], { alt: `Gallery gradient ${i + 1}`, baseUrl, sizes: '(min-width: 800px) 33vw, 100vw' })}<figcaption>Gradient ${i + 1}</figcaption></figure>`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>medkit layout shift</title>
    ${preloadTags(m.hero, { baseUrl, art })}
    <script type="module" src="/packages/elements/dist/image.js"></script>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
      main { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
      .gallery { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      figure { margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>medkit layout shift</h1>
      ${renderImage(m.hero, { alt: 'An orange gradient over dark blue', baseUrl, priority: true, art })}
      <p id="after-hero">Text right after the hero moves if the hero's box changes size when it loads.</p>
      <div style="height: 150vh"><p>Spacer, so the gallery starts far below the fold and loads lazily.</p></div>
      <h2>Gallery</h2>
      <div class="gallery">
${gallery}
      </div>
      <div style="width: 160px">${renderImage(m.logo, { alt: 'A transparent logo', baseUrl, sizes: '160px' })}</div>
      <p id="last">The last paragraph, which moves if anything above it shifts.</p>
    </main>
  </body>
</html>
`;
  await writeFile(resolve(MEDIA, '../layout.html'), html);
}
