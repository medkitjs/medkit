// The M2 gate: no black frame between poster and video, in every engine,
// measured two ways on pages rendered by renderVideoBg():
// - What reached the screen: Playwright records the page at 25 fps, and
//   ffmpeg measures the average brightness of the background's box in every
//   recorded frame. The clips are testsrc2, which has no dark frame, so a dark
//   frame can only come from the element. A frame counts only when the
//   overlay's heading text in it matches a screenshot of that text from an
//   unrecorded copy of the page (SSIM ≥ 0.3; every clip on these pages has
//   the same heading): the
//   element never hides the overlay, so a frame without it is the recorder
//   dropping or tearing the box, which Firefox's does for a frame or two at a
//   time (issue #4), and it is ignored. Measured over 36 runs: intact frames
//   0.47–0.73 (lowest in WebKit, whose text the recording blurs most),
//   dropped and torn ones 0.001–0.17. A tear below the heading would still
//   count, and fail the run falsely; never pass it falsely. Among the frames that count, zero may
//   be dark. So that ignoring frames cannot pass a run with no evidence, each
//   poster→video switch needs 6 counted frames within ±140 ms of it, or the
//   run fails as inconclusive. ±140 ms holds 7 frames at 25 fps; ±100 ms
//   would hold only 5.
//   In Firefox this check is printed, not enforced: its recorder often shows
//   the video without the overlay around a switch, and left too few counted
//   frames in most runs. There, the frame-callback check below is the gate.
// - What the element did: a page script independent of the element counts
//   frames each video presents while playing, and records every moment a
//   poster starts to fade. A fade before its video has presented a playing
//   frame fails, in every engine, which catches a one-frame flash the
//   recording could miss.
//
// Any dark frame with the overlay visible, in any engine and enforced or not,
// keeps the recording and the frames as PNGs in the test's output folder, which
// CI uploads, and prints a warning.
//
// Recording is timing-sensitive, so this file runs in its own *-gate
// projects, one test at a time, after the rest of its engine's tests
// (playwright.config.ts).
//
// The switch is found in the recording by a marker in the viewport's
// top-right corner, which the page script steps one shade of grey darker at
// each poster fade in the background under test: the first frame showing a
// shade is that switch. Firefox's recorder repeats stale frames, in which the
// marker goes back to an earlier shade; a flip between two colours would read
// those as switches, and black would be confused with the frames before the
// first paint.
//
// Not covered: real devices, whose decoders differ; those are checked by hand
// before each minor release.

import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Locator, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 800 };

test.use({ viewport: VIEWPORT, video: { mode: 'on', size: VIEWPORT } });

type Report = { fades: number; early: number };

/** RGB steps per fade; three fades stay clear of black. */
const SHADE = 60;
const MAX_FADES = 3;
/** The luma (limited range, as ffmpeg reads the recording) of the marker after `k` fades. */
const shadeLuma = (k: number) => 16 + ((255 - SHADE * k) * 219) / 255;

/**
 * Records, from the page itself, when each video presented a frame while
 * playing, and when each poster started to fade. Both are compared only at the
 * end: the element's own frame callback runs before this one on the frame that
 * triggers its fade, so a check at fade time would see that frame as missing.
 */
async function watchFades(page: Page, within: string) {
  await page.addInitScript(({ within, SHADE }) => {
    const frames = new Map<HTMLVideoElement, number[]>();
    const fades: { picture: HTMLElement; video?: HTMLVideoElement; at: number }[] = [];
    let marker: HTMLElement | undefined;
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
          // Only this background's fades: two in one recorded frame would cancel
          // out. Set in the same task as the fade, so both reach the screen together.
          if (!target.closest(within)) continue;
          const mine = fades.filter((f) => f.picture.closest(within)).length;
          marker ??= document.body.appendChild(document.createElement('div'));
          const grey = 255 - SHADE * mine;
          marker.style.cssText = `position:fixed;top:0;right:0;width:16px;height:16px;z-index:2147483647;background:rgb(${grey},${grey},${grey})`;
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    (window as unknown as { fadeReport: () => Report }).fadeReport = () => {
      const mine = fades.filter((f) => f.picture.closest(within));
      // 1 ms of slack: Firefox rounds performance.now() down to whole
      // milliseconds but not frame times, so the frame that triggered a fade
      // at 717.1 is seen as after the fade, timed 717. A really early fade is
      // a whole frame (about 16 ms) early, and is still caught.
      const early = mine.filter((f) => !f.video || !(frames.get(f.video) ?? []).some((t) => t <= f.at + 1));
      return { fades: mine.length, early: early.length };
    };
  }, { within, SHADE });
}

const fadeReport = (page: Page) => page.evaluate(() => (window as unknown as { fadeReport: () => Report }).fadeReport());

type Box = { x: number; y: number; width: number; height: number };
type Frame = Record<string, number>;

const DARK = 40;
const OVERLAY_SSIM = 0.3;
// Generous: the start rule may wait 5 s for buffering, on a machine under load.
const POSTER_GONE = { message: 'the poster faded', timeout: 15_000 };
const WINDOW = 0.14;
const MIN_COUNTED = 6;

/** signalstats for one region of every recorded frame, with each frame's index as `n` and time in seconds as `t`. */
async function measure(file: string, { x, y, width, height }: Box): Promise<Frame[]> {
  const crop = `crop=${Math.floor(width)}:${Math.floor(height)}:${Math.max(0, Math.floor(x))}:${Math.max(0, Math.floor(y))}`;
  const { stdout } = await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${crop},signalstats,metadata=print:file=-`, '-f', 'null', '-'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout
    .split(/^frame:/m)
    .slice(1)
    .map((block, n) => {
      const frame: Frame = { n, t: Number(/pts_time:([\d.]+)/.exec(block)![1]) };
      for (const [, key, value] of block.matchAll(/signalstats\.(\w+)=([\d.]+)/g)) frame[key] = Number(value);
      return frame;
    });
}

/** SSIM of one region of every recorded frame against a reference image of that region, in luma. */
async function similarity(file: string, { x, y, width, height }: Box, reference: string): Promise<number[]> {
  const [w, h] = [Math.floor(width), Math.floor(height)];
  const graph = `[0:v]crop=${w}:${h}:${Math.max(0, Math.floor(x))}:${Math.max(0, Math.floor(y))},format=gray[a];[1:v]scale=${w}:${h},format=gray[b];[a][b]ssim=stats_file=-:shortest=1`;
  const { stdout } = await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', file, '-loop', '1', '-i', reference, '-filter_complex', graph, '-f', 'null', '-'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return [...stdout.matchAll(/^n:\d+ .*All:([\d.]+)/gm)].map((m) => Number(m[1]));
}

/**
 * Closes the page, then reads its recording: the switch times from the
 * marker, the frames that count (overlay heading visible), and which of those
 * are dark.
 */
async function recording(page: Page, host: Locator) {
  const box = (await host.boundingBox())!;
  // Every clip's heading reads the same and sits in the same place, so the
  // active one, captured now, is the reference for every frame.
  // The heading's text, not its bar: SSIM rates two flat black areas as
  // identical, so a bar that is mostly black would match a black frame. One
  // whole-pixel rectangle with even sides (ffmpeg's crop rounds odd ones),
  // for both the screenshot and the crop.
  const text = await host.locator('medkit-clip:not([inert]) h2').evaluate((h2) => {
    const range = document.createRange();
    range.selectNodeContents(h2);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
  const even = (n: number) => Math.floor(n / 2) * 2;
  const heading = { x: Math.ceil(text.x), y: Math.ceil(text.y), width: even(text.width - 1), height: even(text.height - 1) };
  // From a separate page with no recording, opened only once the recorded one
  // is closed: a screenshot of the recorded page disturbed Chromium's
  // recording (an extra marker shade, twice), and a second page playing video
  // beside it darkened WebKit's.
  const url = page.url();
  await page.close();
  const reference = test.info().outputPath('heading.png');
  const context = await page.context().browser()!.newContext({ viewport: VIEWPORT, deviceScaleFactor: test.info().project.use.deviceScaleFactor });
  const fresh = await context.newPage();
  await fresh.goto(url);
  await fresh.screenshot({ path: reference, clip: heading, scale: 'css' });
  await context.close();
  const file = await page.video()!.path();
  const [boxes, headings, markers] = await Promise.all([
    measure(file, box),
    similarity(file, heading, reference),
    measure(file, { x: VIEWPORT.width - 12, y: 4, width: 8, height: 8 }),
  ]);
  // A torn frame, or one the recorder dropped the overlay from, does not match
  // the heading; an element that showed black behind an intact overlay does.
  // ffmpeg's ssim sometimes ends a frame early; a frame with no score does not count.
  const counted = boxes.filter((_, i) => (headings[i] ?? 0) >= OVERLAY_SSIM);
  const switches = [];
  for (let k = 1; k <= MAX_FADES; k++) {
    const first = markers.find((m) => Math.abs(m.YAVG - shadeLuma(k)) <= 20);
    if (first) switches.push(first.t);
  }
  return {
    file,
    frames: boxes.length,
    counted: counted.length,
    switches,
    thin: switches.filter((s) => counted.filter((f) => Math.abs(f.t - s) <= WINDOW).length < MIN_COUNTED),
    dark: counted.filter((f) => f.YAVG <= DARK),
  };
}

const describeFrames = (frames: Frame[]) => frames.map((f) => `${f.t.toFixed(2)} s (luma ${f.YAVG.toFixed(1)})`);

/**
 * Keeps the recording and each dark frame as a PNG in the test's output
 * folder, which CI uploads, and warns, in every engine: a dark frame with the
 * overlay visible may be the element's fault even where it does not fail the
 * run.
 */
async function keepDarkFrames(file: string, dark: Frame[], browserName: string) {
  const info = test.info();
  await copyFile(file, info.outputPath('dark-frame-recording.webm'));
  // The first 10 as PNGs; the recording holds them all.
  for (const f of dark.slice(0, 10)) {
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${f.n})`, '-frames:v', '1', info.outputPath(`dark-frame-${f.t.toFixed(2)}s.png`)]);
  }
  const message = `${dark.length} dark frame(s) with the overlay visible in ${browserName}, at ${describeFrames(dark).join(', ')}; recording and frames kept in ${dirname(info.outputPath('x'))}`;
  console.warn(process.env.CI ? `::warning title=video-bg gate::${message}` : `WARNING: ${message}`);
}

async function expectNoDarkFrame(page: Page, host: Locator, fades: Report, minFrames: number, browserName: string) {
  expect(fades.fades, 'fades the marker can tell apart').toBeLessThanOrEqual(MAX_FADES);
  const r = await recording(page, host);
  if (r.dark.length) await keepDarkFrames(r.file, r.dark, browserName);
  if (browserName === 'firefox') {
    const verdict = r.dark.length ? `dark: ${describeFrames(r.dark).join(', ')}` : r.thin.length ? `inconclusive at ${r.thin.join(', ')} s` : 'no dark frame';
    console.log(`Firefox recording, not enforced: ${verdict}; ${r.switches.length} of ${fades.fades} switches found, ${r.counted} of ${r.frames} frames counted`);
    return;
  }
  expect(r.frames, 'recorded frames').toBeGreaterThan(minFrames);
  expect(r.switches.length, 'marker shades in the recording, one per poster fade').toBe(fades.fades);
  expect(r.thin, `inconclusive: switches (s) with fewer than ${MIN_COUNTED} frames showing the overlay within ±${WINDOW * 1000} ms`).toEqual([]);
  expect(describeFrames(r.dark), `dark frames with the overlay visible, of ${r.counted} counted and ${r.frames} recorded`).toEqual([]);
}

test('the hero background goes from poster to video without a dark frame', async ({ page, browserName }) => {
  await watchFades(page, '#bg');
  // Holding the video for a moment puts the switch well inside the recording.
  await page.route('**/*.mp4', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto('/examples/html/video-bg.html');
  const host = page.locator('#bg medkit-video-bg');
  await expect.poll(() => page.locator('#bg picture').evaluate((p) => getComputedStyle(p).opacity), POSTER_GONE).toBe('0');
  await page.waitForTimeout(1000);

  const fades = await fadeReport(page);
  expect(fades.fades, 'no poster fade was seen').toBe(1);
  expect(fades.early, 'posters that faded before their video painted a playing frame').toBe(0);
  await expectNoDarkFrame(page, host, fades, 20, browserName);
});

test('switching clips crossfades without a dark frame', async ({ page, browserName }) => {
  await watchFades(page, '#list');
  await page.goto('/examples/html/video-bg-playlist.html');
  const host = page.locator('#list medkit-video-bg');
  await expect.poll(() => page.locator('#list picture').first().evaluate((p) => getComputedStyle(p).opacity), POSTER_GONE).toBe('0');
  for (let i = 0; i < 2; i++) {
    await host.getByRole('button', { name: 'Next video' }).click();
    await page.waitForTimeout(1500);
  }

  const fades = await fadeReport(page);
  expect(fades.fades, 'poster fades: the first clip and the two it switched to').toBe(3);
  expect(fades.early, 'posters that faded before their video painted a playing frame').toBe(0);
  await expectNoDarkFrame(page, host, fades, 40, browserName);
});
