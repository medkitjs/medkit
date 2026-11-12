// The M2 gate: no black frame between poster and video, in every engine,
// measured two ways on pages rendered by renderVideoBg():
// - What reached the screen: Playwright records the page (about 25 fps in
//   every engine), and ffmpeg measures the average brightness of the
//   background's box in every recorded frame. The clips are testsrc2, which
//   has no dark frame, so a dark frame can only come from the element.
// - What the element did: a page script independent of the element counts
//   frames each video presents while playing, and records every moment a
//   poster starts to fade. A fade before its video has presented a playing
//   frame fails, which catches a one-frame flash the recording could miss.
//
// Firefox's recording alone tolerates a single dark frame, and fails on two
// in a row. Every Firefox failure was one frame in which the untouched
// overlay text and buttons vanished too, so the recorder dropped the whole
// box, not the element; a real Firefox recording at 60 fps showed no dark
// frame (see the issue "Firefox recorder shows single dark frames in the
// video-bg gate"). The frame-callback check stays strict in every engine.
//
// Not covered: real devices, whose decoders differ; those are checked by hand
// before each minor release.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT, video: { mode: 'on', size: VIEWPORT } });

/**
 * Records, from the page itself, when each video presented a frame while
 * playing, and when each poster started to fade. Both are compared only at the
 * end: the element's own frame callback runs before this one on the frame that
 * triggers its fade, so a check at fade time would see that frame as missing.
 */
async function watchFades(page: Page) {
  await page.addInitScript(() => {
    const frames = new Map<HTMLVideoElement, number[]>();
    const fades: { picture: HTMLElement; video?: HTMLVideoElement; at: number }[] = [];
    const count = (video: HTMLVideoElement) =>
      video.requestVideoFrameCallback((now) => {
        if (!video.paused) frames.set(video, [...(frames.get(video) ?? []), now]);
        count(video);
      });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLVideoElement) count(node);
        const target = record.target as HTMLElement;
        // A poster fades once; the first sighting is the earliest, and so the strictest, time.
        if (record.type === 'attributes' && target.localName === 'picture' && target.style.opacity === '0' && !fades.some((f) => f.picture === target)) {
          fades.push({ picture: target, video: target.closest('medkit-clip')?.querySelector('video') ?? undefined, at: performance.now() });
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    (window as unknown as { fadeReport: (within: string) => { fades: number; early: number } }).fadeReport = (within) => {
      const mine = fades.filter((f) => f.picture.closest(within));
      // 1 ms of slack: Firefox rounds performance.now() down to whole
      // milliseconds but not frame times, so the frame that triggered a fade
      // at 717.1 is seen as after the fade, timed 717. A really early fade is
      // a whole frame (about 16 ms) early, and is still caught.
      return { fades: mine.length, early: mine.filter((f) => !f.video || !(frames.get(f.video) ?? []).some((t) => t <= f.at + 1)).length };
    };
  });
}

const DARK = 40;

/** The most dark frames in a row. */
function longestDarkRun(luma: number[]) {
  let run = 0;
  let longest = 0;
  for (const y of luma) longest = Math.max(longest, (run = y <= DARK ? run + 1 : 0));
  return longest;
}

const allowedDarkRun = (browserName: string) => (browserName === 'firefox' ? 1 : 0);

/** Average luma (0–255) of the box in every frame of the page's recording. */
async function brightness(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.close();
  const file = await page.video()!.path();
  const crop = `crop=${Math.floor(box.width)}:${Math.floor(box.height)}:${Math.max(0, Math.floor(box.x))}:${Math.max(0, Math.floor(box.y))}`;
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `${crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-f', 'null', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return [...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}

const fadeReport = (page: Page, within: string) =>
  page.evaluate((w) => (window as unknown as { fadeReport: (w: string) => { fades: number; early: number } }).fadeReport(w), within);

test('the hero background goes from poster to video without a dark frame', async ({ page, browserName }) => {
  await watchFades(page);
  // Holding the video for a moment puts the switch well inside the recording.
  await page.route('**/*.mp4', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto('/examples/html/video-bg.html');
  const host = page.locator('#bg medkit-video-bg');
  await expect.poll(() => page.locator('#bg picture').evaluate((p) => getComputedStyle(p).opacity)).toBe('0');
  await page.waitForTimeout(1000);
  const box = (await host.boundingBox())!;

  const fades = await fadeReport(page, '#bg');
  expect(fades.fades, 'no poster fade was seen').toBe(1);
  expect(fades.early, 'posters that faded before their video painted a playing frame').toBe(0);

  const luma = await brightness(page, box);
  expect(luma.length, 'recorded frames').toBeGreaterThan(20);
  expect(longestDarkRun(luma), `dark frames in a row, of ${luma.length}; darkest ${Math.min(...luma)}`).toBeLessThanOrEqual(allowedDarkRun(browserName));
});

test('switching clips crossfades without a dark frame', async ({ page, browserName }) => {
  await watchFades(page);
  await page.goto('/examples/html/video-bg-playlist.html');
  const host = page.locator('#list medkit-video-bg');
  await expect.poll(() => page.locator('#list picture').first().evaluate((p) => getComputedStyle(p).opacity)).toBe('0');
  for (let i = 0; i < 2; i++) {
    await host.getByRole('button', { name: 'Next video' }).click();
    await page.waitForTimeout(1500);
  }
  const box = (await host.boundingBox())!;

  const fades = await fadeReport(page, '#list');
  expect(fades.fades, 'poster fades: the first clip and the two it switched to').toBe(3);
  expect(fades.early, 'posters that faded before their video painted a playing frame').toBe(0);
  const luma = await brightness(page, box);
  expect(luma.length, 'recorded frames').toBeGreaterThan(40);
  expect(longestDarkRun(luma), `dark frames in a row, of ${luma.length}; darkest ${Math.min(...luma)}`).toBeLessThanOrEqual(allowedDarkRun(browserName));
});
