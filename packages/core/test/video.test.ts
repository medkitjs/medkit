// Covers processVideo with real ffmpeg runs on short clips generated here: the
// H.264 ladder, optional AV1, keyframes, faststart, audio and metadata
// stripping, codec strings, trim and posterAt, the poster, HLS packaging, the
// cache, orphan cleanup, and the bitrate cap per rung. Needs ffmpeg 6+ with libx264 and libsvtav1 on
// PATH, and `pnpm build` (manifests are checked against the built schema).
//
// Not covered: visual quality, which no assertion here can judge, and large
// sources, which only make the same encodes slower.

import { Ajv } from 'ajv';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import schema from '../../elements/dist/manifest.schema.json' with { type: 'json' };
import { checkFfmpeg } from '../src/ffmpeg.js';
import { maxrateFor, processVideo } from '../src/video.js';

const run = promisify(execFile);
const validate = new Ajv({ allErrors: true }).compile(schema);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-video-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** A testsrc2 clip, whose picture changes every frame, with an optional tone and metadata. */
async function clip(name: string, { seconds = 5, size = '320x180', audio = false, metadata = false } = {}) {
  const path = join(dir, name);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`,
    ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440'] : []),
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ...(audio ? ['-c:a', 'aac'] : []),
    ...(metadata ? ['-metadata', 'location=+44.8125+020.4612/', '-metadata', 'title=private'] : []),
    path,
  ]);
  return path;
}

async function probe(file: string, ...args: string[]) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', ...args, file]);
  return JSON.parse(stdout);
}

/** An image file as 64×36 greyscale pixels, for comparing pictures across encodes. */
const still = (file: string) => sharp(file).resize(64, 36, { fit: 'fill' }).greyscale().raw().toBuffer();

/** A video frame as 64×36 greyscale pixels. */
async function thumb(source: string, at = 0) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', source, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  return sharp(stdout).resize(64, 36, { fit: 'fill' }).greyscale().raw().toBuffer();
}

const difference = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

test('a rung missing from the maxrate table gets a cap between its neighbours, or scaled from the nearest', () => {
  const table = { 480: 800, 720: 1600, 1080: 3000 };
  expect(maxrateFor(720, table), 'a listed rung').toBe(1600);
  expect(maxrateFor(600, table), 'halfway between 480 and 720').toBe(1200);
  expect(maxrateFor(240, table), 'below the smallest').toBe(400);
  expect(maxrateFor(2160, table), 'above the largest').toBe(6000);
});

describe('processVideo', { timeout: 60_000 }, () => {
  test("maxrate holds each rung's average bitrate under its cap, AV1 included, and false lifts it", async () => {
    const input = await clip('hero.mp4');
    const kbps = (r: { bytes: number }, duration: number) => (r.bytes * 8) / duration / 1000;

    const capped = await processVideo(input, { outDir: dir, ladder: [180], av1: true, maxrate: { 180: 120 } });
    const free = await processVideo(input, { outDir: join(dir, 'free'), ladder: [180], maxrate: false });

    // The VBV buffer starts full, so a clip may overshoot the cap by up to one
    // buffer (2 × maxrate kbit) spread over its length.
    for (const r of capped.mp4) expect(kbps(r, capped.duration), `${r.src} kbps`).toBeLessThan(120 + (2 * 120) / capped.duration);
    expect(kbps(free.mp4[0], free.duration), 'uncapped kbps, which must exceed the cap for this test to mean anything').toBeGreaterThan(160);
  });

  test('writes one H.264 MP4 per rung no larger than the source, and a manifest that passes the schema', async () => {
    const input = await clip('hero.mp4');

    const manifest = await processVideo(input, { outDir: dir, ladder: [90, 180, 720] });

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({ id: 'hero', kind: 'video', width: 320, height: 180, audio: false });
    expect(manifest.duration).toBeCloseTo(5, 1);
    expect(manifest.mp4.map((r) => [r.src, r.width, r.height])).toEqual([
      ['hero-90p.mp4', 160, 90],
      ['hero-180p.mp4', 320, 180],
    ]);
    for (const r of manifest.mp4) expect((await stat(join(dir, r.src))).size, `${r.src} bytes`).toBe(r.bytes);
  });

  test('every encode has a keyframe at 0 and then every 2 seconds, AV1 included', async () => {
    const input = await clip('hero.mp4', { seconds: 5 });

    const manifest = await processVideo(input, { outDir: dir, ladder: [180], av1: true });

    expect(manifest.mp4.map((r) => r.src)).toEqual(['hero-180p.mp4', 'hero-180p-av1.mp4']);
    for (const r of manifest.mp4) {
      const { frames } = await probe(join(dir, r.src), '-select_streams', 'v', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time');
      expect(frames.map((f: { pts_time: string }) => Number(f.pts_time)), `${r.src} keyframes`).toEqual([0, 2, 4]);
    }
  });

  test('the moov box comes before the media, so playback starts before the download ends', async () => {
    const manifest = await processVideo(await clip('hero.mp4'), { outDir: dir, ladder: [180] });
    const bytes = await readFile(join(dir, manifest.mp4[0].src));
    expect(bytes.indexOf('moov'), 'moov is after mdat').toBeLessThan(bytes.indexOf('mdat'));
  });

  test('codec strings match what ffprobe reads from each file', async () => {
    const manifest = await processVideo(await clip('hero.mp4'), { outDir: dir, ladder: [180], av1: true });
    const [h264, av1] = manifest.mp4;
    const { streams } = await probe(join(dir, h264.src), '-select_streams', 'v', '-show_entries', 'stream=profile,level');
    expect(streams[0].profile).toBe('High');
    expect(h264.codec).toBe(`avc1.6400${streams[0].level.toString(16).padStart(2, '0')}`);
    expect(av1.codec).toMatch(/^av01\.0\.\d\dM\.08$/);
  });

  test('audio is removed unless keepAudio, which keeps it as AAC and records its codec', async () => {
    const input = await clip('talk.mp4', { audio: true });
    const audioStreams = async (src: string) =>
      (await probe(join(dir, src), '-show_entries', 'stream=codec_type,codec_name')).streams.filter((s: { codec_type: string }) => s.codec_type === 'audio');

    const silent = await processVideo(input, { outDir: dir, ladder: [180] });
    expect(silent.audio).toBe(false);
    expect(await audioStreams(silent.mp4[0].src), 'the background kept its audio').toEqual([]);

    const kept = await processVideo(input, { outDir: dir, ladder: [180], keepAudio: true });
    expect(kept.audio).toBe('mp4a.40.2');
    expect((await audioStreams(kept.mp4[0].src)).map((s: { codec_name: string }) => s.codec_name)).toEqual(['aac']);
  });

  test('keepAudio on a source with no audio track records no audio', async () => {
    const manifest = await processVideo(await clip('mute.mp4'), { outDir: dir, ladder: [180], keepAudio: true });
    expect(manifest.audio).toBe(false);
  });

  test('location and every other metadata tag from the source are gone', async () => {
    const input = await clip('phone.mp4', { metadata: true });
    expect((await probe(input, '-show_entries', 'format_tags')).format.tags.location, 'the fixture has a location').toBeDefined();

    const manifest = await processVideo(input, { outDir: dir, ladder: [180] });

    const { tags } = (await probe(join(dir, manifest.mp4[0].src), '-show_entries', 'format_tags')).format;
    expect(Object.keys(tags).filter((k) => !['major_brand', 'minor_version', 'compatible_brands', 'encoder'].includes(k))).toEqual([]);
  });

  test('trim cuts the clip, and the poster is the first frame of the trimmed clip', async () => {
    const input = await clip('long.mp4', { seconds: 6 });

    const manifest = await processVideo(input, { outDir: dir, ladder: [180], trim: { start: 2, end: 4 } });

    expect(manifest.duration).toBeCloseTo(2, 1);
    expect(manifest.poster.at, 'a trimmed clip still starts its poster at 0').toBeUndefined();
    const poster = join(dir, JSON.parse(await readFile(join(dir, `${manifest.poster.id}.json`), 'utf8')).jpeg.at(-1).src);
    const posterThumb = await still(poster);
    expect(difference(posterThumb, await thumb(input, 2)), 'poster vs source at 2s').toBeLessThan(6);
    expect(difference(posterThumb, await thumb(input, 0)), 'poster vs source at 0s').toBeGreaterThan(difference(posterThumb, await thumb(input, 2)));
  });

  test('posterAt takes the poster from that moment and records it, so playback can start there', async () => {
    const input = await clip('hero.mp4', { seconds: 4 });

    const manifest = await processVideo(input, { outDir: dir, ladder: [180], posterAt: 3 });

    expect(manifest.poster.at).toBe(3);
    expect(manifest.poster.id).toBe('hero-poster');
    const poster = join(dir, JSON.parse(await readFile(join(dir, 'hero-poster.json'), 'utf8')).jpeg.at(-1).src);
    expect(difference(await still(poster), await thumb(input, 3)), 'poster vs source at 3s').toBeLessThan(6);
  });

  test('a posterAt or trim outside the clip is refused before anything is written', async () => {
    const input = await clip('hero.mp4', { seconds: 2 });
    await expect(processVideo(input, { outDir: join(dir, 'out'), posterAt: 5 })).rejects.toThrow(/posterAt 5s is past the end/);
    await expect(processVideo(input, { outDir: join(dir, 'out'), trim: { start: 3, end: 2 } })).rejects.toThrow(/trim needs/);
    await expect(stat(join(dir, 'out')), 'the output folder was created').rejects.toThrow();
  });

  test('HLS is packaged from the same encodes into fMP4 variants under one master playlist', async () => {
    const manifest = await processVideo(await clip('talk.mp4', { seconds: 9, audio: true }), {
      outDir: dir,
      ladder: [90, 180],
      hls: true,
      keepAudio: true,
    });

    expect(manifest.hls).toBe('talk/master.m3u8');
    const master = await readFile(join(dir, 'talk/master.m3u8'), 'utf8');
    expect(master).toContain('RESOLUTION=160x90,CODECS="avc1.');
    expect(master).toContain('RESOLUTION=320x180,CODECS="avc1.');
    expect(master).toContain('mp4a.40.2');
    const variant = await readFile(join(dir, 'talk/180p.m3u8'), 'utf8');
    expect(variant).toContain('#EXT-X-MAP:URI="180p_init.mp4"');
    const durations = [...variant.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
    expect(durations, 'about 4-second segments').toEqual([4, 4, 1]);
  });

  test('a second run with the same file and options reuses every output', async () => {
    const input = await clip('hero.mp4');
    const first = await processVideo(input, { outDir: dir, ladder: [180] });
    const written = (await stat(join(dir, first.mp4[0].src))).mtimeMs;

    expect(await processVideo(input, { outDir: dir, ladder: [180] })).toEqual(first);
    expect((await stat(join(dir, first.mp4[0].src))).mtimeMs, 'the MP4 was encoded again').toBe(written);
  });

  test('rewriting a manifest deletes the renditions and HLS files only the old one listed', async () => {
    const input = await clip('talk.mp4', { seconds: 9 });
    await processVideo(input, { outDir: dir, ladder: [90, 180], hls: true });
    expect(await readdir(join(dir, 'talk'))).toContain('90p_000.m4s');

    await processVideo(input, { outDir: dir, ladder: [180], hls: true });

    const top = await readdir(dir);
    expect(top).not.toContain('talk-90p.mp4');
    expect(top).toContain('talk-180p.mp4');
    const hls = await readdir(join(dir, 'talk'));
    expect(hls.filter((f) => f.startsWith('90p')), 'old variant files').toEqual([]);
    expect(hls).toContain('180p_000.m4s');
  });

  test('a tampered manifest whose id points outside outDir deletes nothing there', async () => {
    const input = await clip('hero.mp4', { seconds: 2 });
    const out = join(dir, 'out');
    await processVideo(input, { outDir: out, ladder: [180] });
    await writeFile(join(dir, 'master.m3u8'), 'keep me');
    const manifest = JSON.parse(await readFile(join(out, 'hero.json'), 'utf8'));
    Object.assign(manifest, { id: '..', hls: '../master.m3u8', hash: 'stale' });
    await writeFile(join(out, 'hero.json'), JSON.stringify(manifest));

    await processVideo(input, { outDir: out, ladder: [180] });

    await expect(readFile(join(dir, 'master.m3u8'), 'utf8'), 'a file outside outDir was deleted').resolves.toBe('keep me');
  });
});

test('a missing ffmpeg stops with a message saying how to install it', async () => {
  await expect(checkFfmpeg(['libx264'], 'medkit-no-such-ffmpeg')).rejects.toThrow(/could not be run\. Install it/);
});

test('an ffmpeg built without a needed encoder is named in the error', async () => {
  await expect(checkFfmpeg(['libmedkit-imaginary'])).rejects.toThrow(/built without libmedkit-imaginary/);
});
