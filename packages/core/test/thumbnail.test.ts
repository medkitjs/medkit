// Covers processThumbnail with a fake fetch: YouTube's maxres thumbnail, the
// fall back to hqdefault with its letterbox cropped away, Vimeo through
// oEmbed, refusing ids and URLs that could point elsewhere, and that a
// thumbnail already processed is never fetched again.
//
// Not covered: the real providers, which a unit test must not depend on; the
// URLs fetched are asserted instead.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { processThumbnail } from '../src/thumbnail.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-thumb-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const jpeg = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c2410c' } }).jpeg().toBuffer();

/** A fetch that answers from `routes` by URL, 404 for anything else, and records every URL asked for. */
function fake(routes: Record<string, () => Promise<Response>>) {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    return routes[url]?.() ?? new Response(null, { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const image = async (width: number, height: number) => new Response(await jpeg(width, height));

test("a YouTube video's maxres thumbnail goes through the image pipeline as youtube-<id>", async () => {
  const { fetch, asked } = fake({ 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg': () => image(1280, 720) });
  const manifest = await processThumbnail('youtube', 'dQw4w9WgXcQ', { outDir: dir, fetch });
  expect(manifest).toMatchObject({ id: 'youtube-dQw4w9WgXcQ', width: 1280, height: 720 });
  expect(asked).toEqual(['https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg']);
});

test('without a maxres thumbnail, hqdefault is used with its letterbox cropped to 16:9', async () => {
  const { fetch, asked } = fake({ 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg': () => image(480, 360) });
  const manifest = await processThumbnail('youtube', 'abcdefghijk', { outDir: dir, fetch });
  expect(asked).toEqual(['https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg', 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg']);
  expect(manifest.width / manifest.height).toBeCloseTo(16 / 9, 2);
});

test('a Vimeo thumbnail comes from the URL its oEmbed names', async () => {
  const oembed = 'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&width=1920';
  const { fetch, asked } = fake({
    [oembed]: async () => Response.json({ thumbnail_url: 'https://i.vimeocdn.com/video/452001751-1920x1080' }),
    'https://i.vimeocdn.com/video/452001751-1920x1080': () => image(1920, 1080),
  });
  expect(await processThumbnail('vimeo', '76979871', { outDir: dir, fetch })).toMatchObject({ id: 'vimeo-76979871', width: 1920 });
  expect(asked).toEqual([oembed, 'https://i.vimeocdn.com/video/452001751-1920x1080']);
});

test('once processed, a thumbnail is never fetched again', async () => {
  const { fetch, asked } = fake({ 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg': () => image(1280, 720) });
  const first = await processThumbnail('youtube', 'dQw4w9WgXcQ', { outDir: dir, fetch });
  expect(await processThumbnail('youtube', 'dQw4w9WgXcQ', { outDir: dir, fetch })).toEqual(first);
  expect(asked, 'requests over two runs').toHaveLength(1);
});

test('an id that could change the URL, an unknown provider, a missing thumbnail or a non-https one is an error', async () => {
  const { fetch, asked } = fake({
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1&width=1920': async () => Response.json({ thumbnail_url: 'http://example.com/x.jpg' }),
  });
  await expect(processThumbnail('youtube', '../../x?a=b', { outDir: dir, fetch })).rejects.toThrow(/not a youtube video id/);
  await expect(processThumbnail('vimeo', '1/../2', { outDir: dir, fetch })).rejects.toThrow(/not a vimeo video id/);
  await expect(processThumbnail('dailymotion' as 'youtube', 'x', { outDir: dir, fetch })).rejects.toThrow(/not a provider/);
  expect(asked, 'requests for refused ids').toEqual([]);
  await expect(processThumbnail('youtube', 'zzzzzzzzzzz', { outDir: dir, fetch })).rejects.toThrow(/no thumbnail \(HTTP 404\)/);
  await expect(processThumbnail('vimeo', '1', { outDir: dir, fetch })).rejects.toThrow(/no https thumbnail_url/);
});
