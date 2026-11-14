// Covers how <medkit-player> chooses what to play, in every engine: native HLS
// where the browser has it, hls.js only when opted in (the `hls` entry or
// configure({ hls })) and only once an HLS source is played without native
// HLS, and otherwise the smallest MP4 that covers the player's width.
//
// Not covered here: that a build without hls.js succeeds (tests/build.test.ts),
// and adaptive switching inside hls.js, which is hls.js's own. In WebKit,
// hls.js playback is checked as attached, not as progressing: Playwright's
// Linux WebKit has no native HLS, and its Media Source stalled bare hls.js,
// with no medkit on the page, at 0.17 s in 1 of 4 runs. Safari plays HLS
// natively and never takes this path.

import { expect, test, type Page } from '@playwright/test';

/** Every request so far for hls.js itself (not medkit's `hls` entry), and every HLS playlist. */
function requests(page: Page) {
  const seen = { hlsjs: [] as string[], playlists: [] as string[] };
  page.on('request', (r) => {
    if (/node_modules\/[^?]*hls/.test(r.url())) seen.hlsjs.push(r.url());
    if (r.url().endsWith('.m3u8')) seen.playlists.push(r.url());
  });
  return seen;
}

const video = (page: Page) => page.locator('#inline video');
const native = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => !!v.canPlayType('application/vnd.apple.mpegurl'));
const play = (page: Page) => page.locator('#inline').getByRole('button', { name: 'Play' }).click();
const playing = (page: Page) =>
  expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.2), { timeout: 10_000 }).toBe(true);
const currentSrc = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentSrc);
/** Through hls.js: attached by Media Source, and progressing except in WebKit (see the top). */
async function playingThroughHlsJs(page: Page, browserName: string) {
  await expect.poll(() => currentSrc(page), 'played through Media Source').toMatch(/^blob:/);
  if (browserName !== 'webkit') await playing(page);
}

test('without hls.js opted in, native HLS plays where the browser has it, and elsewhere the smallest MP4 covering the player', async ({ page }) => {
  const seen = requests(page);
  await page.goto('/examples/html/player.html');
  await play(page);
  await playing(page);
  if (await native(page)) {
    expect(await currentSrc(page)).toMatch(/talk-player\/master\.m3u8$/);
  } else {
    // 854 px covers an 800 px player at a device pixel ratio of 1; at 2, only the largest comes close.
    const need = await page.locator('#inline medkit-player').evaluate((p) => p.clientWidth * devicePixelRatio);
    expect(await currentSrc(page)).toMatch(need <= 854 ? /talk-player-480p\.mp4$/ : /talk-player-720p\.mp4$/);
    expect(seen.playlists, 'HLS playlists requested').toEqual([]);
  }
  expect(seen.hlsjs, 'hls.js requested').toEqual([]);
});

test('with the hls entry, hls.js loads only at the first play, and only in a browser without native HLS', async ({ page, browserName }) => {
  const seen = requests(page);
  await page.goto('/examples/html/player-hls.html');
  await page.waitForLoadState('networkidle');
  expect(seen.hlsjs, 'hls.js requested before play').toEqual([]);
  await play(page);
  if (await native(page)) {
    await playing(page);
    expect(seen.hlsjs, 'hls.js requested where HLS is native').toEqual([]);
    expect(await currentSrc(page)).toMatch(/master\.m3u8$/);
  } else {
    await playingThroughHlsJs(page, browserName);
    expect(seen.hlsjs.length, 'hls.js requests').toBeGreaterThan(0);
    expect(seen.playlists.some((u) => u.endsWith('talk-player/master.m3u8'))).toBe(true);
  }
});

test('with no bundler, configure({ hls }) loads hls.js from a URL the same way', async ({ page, browserName }) => {
  const seen = requests(page);
  await page.goto('/examples/html/player.html');
  test.skip(await native(page), 'this browser plays HLS natively, so hls.js never loads');
  await page.evaluate(
    async ([index, hls]) => {
      const { configure } = (await import(index)) as typeof import('@medkitjs/elements');
      configure({ hls: () => import(hls) });
    },
    ['/packages/elements/dist/index.js', '/packages/elements/node_modules/hls.js/dist/hls.mjs'],
  );
  expect(seen.hlsjs, 'hls.js requested before play').toEqual([]);
  await play(page);
  await playingThroughHlsJs(page, browserName);
});
