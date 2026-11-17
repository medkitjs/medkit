// Covers the plugin inside real Vite builds of a throwaway project: an image
// and a video import give their manifests, the files land in outDir and ship
// with the build, medkit.config.js applies (outDir; per-file video options keyed
// from srcDir, and a video outside srcDir still imports with the defaults), a
// video.files key that names nothing in srcDir fails the build,
// and two sources with one stem fail instead of overwriting each other. Also
// type-checks the `?medkit` declarations in client.d.ts. Needs ffmpeg on PATH.
//
// Not covered: dev-server caching, which is core's hash cache (core's tests);
// the once-per-file guard for SSR builds, which only shows as a race; and
// what each manifest holds, which core's tests check.

/// <reference path="../client.d.ts" />

import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { ImageManifest, VideoManifest } from '@medkitjs/elements';
import sharp from 'sharp';
import { build } from 'vite';
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from 'vitest';
import medkit from '../src/index.js';
import type hero from './types/hero.jpg?medkit';
import type clip from './types/clip.mp4?medkit';
import type other from './types/thing?medkit';

vi.setConfig({ testTimeout: 60_000 });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'medkit-vite-'));
  await mkdir(join(root, 'src/a'), { recursive: true });
  await mkdir(join(root, 'src/b'), { recursive: true });
  await mkdir(join(root, 'src/media'), { recursive: true });
  await sharp({ create: { width: 800, height: 450, channels: 3, background: '#c2410c' } }).jpeg().toFile(join(root, 'src/hero.jpg'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const write = (path: string, text: string) => writeFile(join(root, path), text);

/** Builds src/main.js as an ES library and imports the result. */
async function bundle() {
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [medkit()],
    build: { outDir: 'dist', lib: { entry: 'src/main.js', formats: ['es'], fileName: 'main' } },
  });
  return (await import(pathToFileURL(join(root, 'dist/main.mjs')).href)) as { hero: ImageManifest; clip: VideoManifest; loose: VideoManifest };
}

test('an image import gives its manifest, and its files ship with the build', async () => {
  await write('src/main.js', `export { default as hero } from './hero.jpg?medkit';`);
  const { hero } = await bundle();

  expect(hero).toMatchObject({ v: 1, id: 'hero', kind: 'image', width: 800, height: 450 });
  const files = await readdir(join(root, 'dist/media'));
  for (const { src } of [...hero.avif, ...hero.webp, ...hero.jpeg]) expect(files, 'a rendition missing from the build').toContain(src);
  await expect(access(join(root, 'public/media/hero.json')), 'the manifest in outDir').resolves.toBeUndefined();
});

const clipAt = (path: string) =>
  promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1', '-pix_fmt', 'yuv420p', join(root, path)]);

test('a video in srcDir gets its own options from video.files, keyed from srcDir; one outside srcDir imports with the defaults', async () => {
  await clipAt('src/media/clip.mp4');
  await clipAt('src/a/loose.mp4');
  await write('medkit.config.js', `export default { outDir: 'public/assets', video: { ladder: [180], files: { 'clip.mp4': { ladder: [240] } } } };`);
  await write('src/main.js', `export { default as clip } from './media/clip.mp4?medkit';\nexport { default as loose } from './a/loose.mp4?medkit';`);
  const { clip, loose } = await bundle();

  expect(clip).toMatchObject({ id: 'clip', kind: 'video' });
  expect(clip.mp4.map((r) => r.height), 'the per-file ladder').toEqual([240]);
  expect(loose.mp4.map((r) => r.height), 'the default ladder').toEqual([180]);
  expect(await readdir(join(root, 'dist/assets')), 'the encode, shipped from outDir').toContain(clip.mp4[0].src);
});

test('a video.files key that names no video in srcDir fails the build, even when the file exists elsewhere', async () => {
  await clipAt('src/clip.mp4');
  await write('medkit.config.js', `export default { video: { files: { 'clip.mp4': { ladder: [240] } } } };`);
  await write('src/main.js', `export { default as hero } from './hero.jpg?medkit';`);
  await expect(bundle()).rejects.toThrow('names "clip.mp4", which is not a video');
});

test('two sources with the same name fail the build instead of overwriting each other', async () => {
  await sharp(join(root, 'src/hero.jpg')).toFile(join(root, 'src/a/hero.png'));
  await write('src/main.js', `export { default as one } from './hero.jpg?medkit';\nexport { default as two } from './a/hero.png?medkit';`);
  await expect(bundle()).rejects.toThrow('would both write "hero"');
});

test('a ?medkit import of something that is neither image nor video fails the build', async () => {
  await write('src/b/notes.txt', 'hello');
  await write('src/main.js', `export { default as notes } from './b/notes.txt?medkit';`);
  await expect(bundle()).rejects.toThrow('?medkit takes an image or a video');
});

test('client.d.ts types an image import as an image manifest and a video import as a video manifest', () => {
  expectTypeOf<typeof hero>().toEqualTypeOf<ImageManifest>();
  expectTypeOf<typeof clip>().toEqualTypeOf<VideoManifest>();
  expectTypeOf<typeof other>().toEqualTypeOf<ImageManifest | VideoManifest>();
});
