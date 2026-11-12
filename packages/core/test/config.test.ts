// Covers loadConfig: defaults without a file, resolving outDir against the
// config's folder, the trailing slash on baseUrl, video defaults and per-file
// options, and refusing a config that would otherwise silently fall back to
// defaults.
//
// Not covered: TypeScript or CommonJS config files, which are not supported;
// only `medkit.config.js` as an ES module is read.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadConfig, videoOptionsFor } from '../src/index.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-config-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const write = (body: string) => writeFile(join(dir, 'medkit.config.js'), body);

test('without a config file, media goes to public/media and is served from /media/', async () => {
  expect(await loadConfig(dir)).toEqual({
    outDir: join(dir, 'public/media'),
    baseUrl: '/media/',
    video: { ladder: [480, 720, 1080], av1: false, hls: false, keepAudio: false, maxrate: { 480: 800, 720: 1600, 1080: 3000 }, files: {} },
  });
});

test('outDir is resolved against the folder holding the config, and baseUrl always ends in a slash', async () => {
  await write(`export default { outDir: 'public/assets/video', baseUrl: 'https://cdn.example.com/media' };`);
  expect(await loadConfig(dir)).toMatchObject({
    outDir: join(dir, 'public/assets/video'),
    baseUrl: 'https://cdn.example.com/media/',
  });
});

test('a misspelt option is an error instead of a silent default', async () => {
  await write(`export default { outdir: 'public/media' };`);
  await expect(loadConfig(dir)).rejects.toThrow(/unknown option "outdir"/);
});

test('an option of the wrong type is an error', async () => {
  await write(`export default { baseUrl: 42 };`);
  await expect(loadConfig(dir)).rejects.toThrow(/"baseUrl" must be a non-empty string/);
});

test('a config without a default export is an error', async () => {
  await write(`export const outDir = 'x';`);
  await expect(loadConfig(dir)).rejects.toThrow(/export default an object/);
});

test('per-file video options override the video defaults for that file only', async () => {
  await write(`export default { video: { av1: true, files: { 'clips/hero.mp4': { trim: { start: 2, end: 12 }, posterAt: 0, keepAudio: true } } } };`);
  const config = await loadConfig(dir);

  expect(videoOptionsFor(config, 'clips/hero.mp4')).toEqual({
    ladder: [480, 720, 1080],
    av1: true,
    hls: false,
    keepAudio: true,
    maxrate: { 480: 800, 720: 1600, 1080: 3000 },
    trim: { start: 2, end: 12 },
    posterAt: 0,
  });
  expect(videoOptionsFor(config, 'other.mp4')).toEqual({ ladder: [480, 720, 1080], av1: true, hls: false, keepAudio: false, maxrate: { 480: 800, 720: 1600, 1080: 3000 } });
});

test('maxrate replaces the default caps as a whole, or turns them off for one file', async () => {
  await write(`export default { video: { maxrate: { 720: 1200 }, files: { 'loop.mp4': { maxrate: false } } } };`);
  const config = await loadConfig(dir);
  expect(videoOptionsFor(config, 'hero.mp4').maxrate).toEqual({ 720: 1200 });
  expect(videoOptionsFor(config, 'loop.mp4').maxrate).toBe(false);
});

test('a Windows-style path in video.files matches the same file', async () => {
  await write(`export default { video: { files: { 'clips\\\\hero.mp4': { keepAudio: true } } } };`);
  expect(videoOptionsFor(await loadConfig(dir), 'clips/hero.mp4').keepAudio).toBe(true);
});

test.each([
  [`{ video: { ladr: [480] } }`, /unknown option "ladr" in "video"/],
  [`{ video: { files: { 'a.mp4': { trimm: {} } } } }`, /unknown option "trimm" in "video.files\["a.mp4"\]"/],
  [`{ video: { ladder: [480.5] } }`, /"video.ladder" must list whole numbers/],
  [`{ video: { av1: 'yes' } }`, /"video.av1" must be true or false/],
  [`{ video: { maxrate: { 720: 1.5 } } }`, /"video.maxrate" must map ladder heights to whole kbps/],
  [`{ video: { maxrate: {} } }`, /"video.maxrate" must map ladder heights to whole kbps/],
  [`{ video: { maxrate: true } }`, /"video.maxrate" must map ladder heights to whole kbps/],
  [`{ video: { files: { 'a.mp4': { trim: { start: 5, end: 2 } } } } }`, /needs start < end/],
  [`{ video: { files: { 'a.mp4': { posterAt: -1 } } } }`, /posterAt" must be a number of seconds/],
  [`{ video: { files: { '../outside.mp4': {} } } }`, /must be a path inside the source folder/],
  [`{ video: { files: { '/abs/hero.mp4': {} } } }`, /must be a path inside the source folder/],
])('a video config of %s is refused', async (config, error) => {
  await write(`export default ${config};`);
  await expect(loadConfig(dir)).rejects.toThrow(error);
});
