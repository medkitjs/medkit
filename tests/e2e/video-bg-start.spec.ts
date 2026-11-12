// Covers when <medkit-video-bg> starts its video and which rendition it picks:
// stepping down to what the downlink sustains, staying on the poster when the
// downlink is below every rendition, playing through a throttled network on
// the poster's estimate alone without a stall, and the intro colour that
// replaces the first poster until a video will not play.
//
// The step-down rules themselves are unit-tested in rendition.test.ts.
//
// Not covered: the throttled run outside Chromium, because only Chromium lets
// Playwright shape the network (CDP); Firefox and WebKit rely on the same
// code and on the manual real-device check in the M2 checklist. Nor the 5
// second readyState fallback, which only matters on a network slow enough to
// starve canplaythrough, and the iPhone check covers.

import { expect, test, type Page } from '@playwright/test';

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
      document.addEventListener('waiting', () => log.aheadAtStart >= 0 && log.waiting++, true);
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
