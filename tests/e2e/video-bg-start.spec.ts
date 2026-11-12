// Covers when <medkit-video-bg> starts its video and which rendition it picks:
// stepping down to what the downlink sustains, staying on the poster when the
// downlink is below every rendition, playing through a throttled network on
// the poster's estimate alone without a stall, and the intro colour that
// replaces the first poster until a video will not play.
//
// Also the start rule's iOS paths, simulated by forcing preload to metadata:
// autoplay on suspend, a visitor's Play skipping the rule, and the button's
// label once the video exists.
//
// The step-down rules themselves are unit-tested in rendition.test.ts.
//
// Not covered: the throttled run outside Chromium, because only Chromium lets
// Playwright shape the network (CDP); Firefox and WebKit rely on the same
// code and on the manual real-device check in the M2 checklist. Nor the 5
// second readyState fallback, which only matters on a network slow enough to
// starve canplaythrough, and the iPhone check covers.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { MEDIA } from './setup.js';

const PAGE = '/examples/html/video-bg.html';

const isPlaying = (page: Page, id: string) =>
  page.locator(`#${id} video`).evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0).catch(() => false);
const currentSrc = (page: Page, id: string) => page.locator(`#${id} video`).evaluate((v: HTMLVideoElement) => v.currentSrc);

/** No Resource Timing entries, and a fake navigator.connection, so the choice rests on `downlink` alone. */
const downlink = (page: Page, mbps: number) =>
  page.addInitScript((mbps) => {
    performance.setResourceTimingBufferSize(0);
    Object.defineProperty(navigator, 'connection', { value: { downlink: mbps } });
  }, mbps);

test('a connection too slow for the rendition that fits the box gets the largest one it can sustain', async ({ page }) => {
  await downlink(page, 1.2);
  await page.goto(PAGE);
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);
  expect(await currentSrc(page, 'bg'), 'the 720p rendition averages over 1.2 Mbps').toMatch(/-480p\.mp4$/);
});

test('when not even the smallest rendition can be sustained, no video loads and the poster stays', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => r.url().endsWith('.mp4') && requests.push(r.url()));
  await downlink(page, 0.3);
  await page.goto(PAGE);
  await page.waitForTimeout(1500);
  expect(requests, 'video requested on a 0.3 Mbps connection').toEqual([]);
  expect(await page.locator('#bg picture').evaluate((p) => getComputedStyle(p).opacity)).toBe('1');
});

type Played = { at: number; readyState: number };

/** The byte just past an MP4's moov box (ftyp, moov, then the frames in mdat). */
function metadataEnd(file: Buffer) {
  for (let at = 0; at < file.length; at += file.readUInt32BE(at)) {
    if (file.toString('latin1', at + 4, at + 8) === 'moov') return at + file.readUInt32BE(at);
  }
  throw new Error('no moov box');
}
type Media = { type: string; at: number; readyState: number };

/**
 * iOS Safari loads no further than metadata until play() is called, whatever
 * `preload` says. Forcing `preload` to `metadata` gets close, but these short
 * fixtures still buffer past 3 seconds, so the element is also kept from
 * hearing canplay, canplaythrough and progress: to it, nothing is buffered.
 * `silentSuspend` hides suspend too, so only a visitor's action or the
 * 5-second fallback can start the video. Records every play() call and the
 * media events the start rule depends on.
 */
const likeIos = (page: Page, silentSuspend = false) =>
  page.addInitScript((silent) => {
    Object.defineProperty(HTMLMediaElement.prototype, 'preload', {
      configurable: true,
      get() {
        return this.getAttribute('preload') ?? '';
      },
      set() {
        this.setAttribute('preload', 'metadata');
      },
    });
    for (const handler of ['oncanplay', 'oncanplaythrough', 'onprogress', ...(silent ? ['onsuspend'] : [])]) {
      Object.defineProperty(HTMLMediaElement.prototype, handler, { configurable: true, get: () => null, set() {} });
    }
    const w = window as unknown as { played: { at: number; readyState: number }[]; media: { type: string; at: number; readyState: number }[] };
    w.played = [];
    w.media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      w.played.push({ at: performance.now(), readyState: this.readyState });
      return play.call(this);
    };
    for (const type of ['loadstart', 'suspend', 'canplaythrough']) {
      document.addEventListener(type, (e) => w.media.push({ type, at: performance.now(), readyState: (e.target as HTMLMediaElement).readyState }), true);
    }
  }, silentSuspend);

const record = (page: Page) =>
  page.evaluate(() => {
    const { played, media } = window as unknown as { played: Played[]; media: Media[] };
    return { played, media };
  });

test.describe('when the browser loads only metadata before play(), as iOS does', () => {
  test('autoplay starts on suspend, with nothing buffered, well before the 5-second fallback', async ({ page }) => {
    await likeIos(page);
    await page.goto(PAGE);
    await expect.poll(() => isPlaying(page, 'bg'), { timeout: 4000, message: 'playing within 4 s' }).toBe(true);
    const { played, media } = await record(page);
    const loadstart = media.find((m) => m.type === 'loadstart')!;
    const suspend = media.find((m) => m.type === 'suspend');
    expect(suspend, 'a suspend event').toBeDefined();
    expect(played[0].at, 'first play() before the suspend that should trigger it').toBeGreaterThanOrEqual(suspend!.at);
    expect(played[0].at - loadstart.at, 'ms from loadstart to play(), the 5-second fallback being 5000').toBeLessThan(4000);
  });

  test('the button offers pause as soon as the video exists, because it is waiting to play', async ({ page }) => {
    await likeIos(page, true);
    await page.goto(PAGE);
    await expect(page.locator('#bg video')).toHaveCount(1);
    await expect(page.locator('#bg medkit-video-bg').getByRole('button'), 'the label drawn before the video existed').toHaveAccessibleName('Pause background video');
  });

  test('a visitor pressing Play starts the video at once, even with only metadata loaded', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', "the route does not hold back WebKit's media loads: readyState reached 4 with every later range held");
    await likeIos(page, true);
    // The first request gets the moov box and 32 KB of frames, which Chromium's
    // demuxer reads before it reports metadata (with the moov box alone it
    // stays at 0); every later range waits for the press: readyState stays at 1.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/bg-*.mp4', async (route) => {
      if (!/^bytes=0-/.test(route.request().headers().range ?? 'bytes=0-')) {
        await held;
        return route.continue();
      }
      const file = await readFile(`${MEDIA}/${new URL(route.request().url()).pathname.split('/').pop()}`);
      const end = metadataEnd(file) + 32 * 1024;
      await route.fulfill({
        status: 206,
        headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes 0-${end - 1}/${file.length}` },
        body: file.subarray(0, end),
      });
    });
    await page.goto(PAGE);
    const video = page.locator('#bg video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { message: 'metadata loaded' }).toBe(1);
    await page.waitForTimeout(500);
    expect((await record(page)).played, 'play() calls before any visitor action, with suspend silenced').toEqual([]);

    const button = page.locator('#bg medkit-video-bg').getByRole('button');
    await button.click();
    await expect(button).toHaveAccessibleName('Play background video');
    await button.click();
    const { played } = await record(page);
    expect(played.length, 'play() calls from the Play press').toBe(1);
    expect(played[0].readyState, 'readyState when Play called play()').toBe(1);
    release();
    await expect.poll(() => isPlaying(page, 'bg'), { message: 'playing once the rest arrives' }).toBe(true);
  });
});

test.describe('on a throttled network', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium can shape the network from Playwright');

  test('with only the poster to judge by, as in Firefox and Safari, the video steps down a rung and plays through without a stall', async ({ page }) => {
    test.setTimeout(90_000);
    const cdp = await page.context().newCDPSession(page);
    // About Good 3G: 1.5 Mbps down, 150 ms round trip.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_500_000 / 8, uploadThroughput: 750_000 / 8 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { value: undefined });
      const log = { canplaythrough: false, aheadAtStart: -1, waiting: 0 };
      (window as unknown as { startLog: typeof log }).startLog = log;
      document.addEventListener('canplaythrough', () => (log.canplaythrough = true), true);
      document.addEventListener('playing', (e) => {
        const v = e.target as HTMLVideoElement;
        if (log.aheadAtStart < 0) log.aheadAtStart = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
      }, true);
      // The native loop's seek back to 0 fires waiting too, in Chromium even
      // with the whole clip buffered; that is not a network stall.
      document.addEventListener('waiting', (e) => log.aheadAtStart >= 0 && !(e.target as HTMLVideoElement).seeking && log.waiting++, true);
    });
    await page.goto(PAGE);
    await expect.poll(() => isPlaying(page, 'bg'), { timeout: 60_000 }).toBe(true);
    // The poster reads far below the link (414 kbps), but may only step one rung down from 720p.
    expect(await currentSrc(page, 'bg'), 'the rendition one rung below the size-based 720p').toMatch(/-480p\.mp4$/);

    // Longer than the 6-second clip, so a stall anywhere in it shows.
    await page.waitForTimeout(8000);
    const log = await page.evaluate(() => (window as unknown as { startLog: { canplaythrough: boolean; aheadAtStart: number; waiting: number } }).startLog);
    expect(log.canplaythrough || log.aheadAtStart >= 3, `started with ${log.aheadAtStart.toFixed(2)} s buffered and no canplaythrough`).toBe(true);
    expect(log.waiting, 'stalls after playback started').toBe(0);
  });
});

test.describe('with an intro colour', () => {
  const INTRO = '/examples/html/video-bg-intro.html';

  test('only the colour shows before the first frame, no poster is fetched, then the video fades in', async ({ page }) => {
    const images: string[] = [];
    page.on('request', (r) => r.resourceType() === 'image' && images.push(r.url()));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/*.mp4', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(INTRO);
    const box = (await page.locator('#intro medkit-video-bg').boundingBox())!;
    await expect(page.locator('#intro video')).toHaveCount(1);
    // Right of the overlay and above the controls: nothing but the background.
    const shot = await page.screenshot({ clip: { x: box.x + box.width * 0.5, y: box.y + box.height * 0.3, width: box.width * 0.3, height: box.height * 0.3 } });
    const colours = await page.evaluate(async (png) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const seen = new Set<string>();
      for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return [...seen];
    }, shot.toString('base64'));
    expect(colours, 'colours in the background before the first frame').toEqual(['51,102,204']);

    release();
    await expect.poll(() => page.locator('#intro video').evaluate((v) => getComputedStyle(v).opacity)).toBe('1');
    expect(await isPlaying(page, 'intro')).toBe(true);
    expect(images.filter((u) => u.includes('bg-poster')), 'poster requests while a video plays').toEqual([]);
  });

  test('with reduced motion no video plays, so the held-back poster shows over the colour', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(INTRO);
    const img = page.locator('#intro picture img');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { message: 'the poster loaded' }).toBe(true);
    expect(await page.locator('#intro picture').evaluate((p) => getComputedStyle(p).opacity), 'poster opacity').toBe('1');
    await expect(page.locator('#intro video'), 'a video under reduced motion').toHaveCount(0);
  });
});
