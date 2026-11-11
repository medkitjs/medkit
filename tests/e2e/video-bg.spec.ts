// Covers <medkit-video-bg> in every engine: lazy loading, the poster staying
// until a frame has painted, the skip conditions, the autoplay-blocked
// fallback, pausing offscreen and in a hidden tab, the visitor's pause and its
// memory, and the pause and sound controls.
//
// Not covered here: the playlist (video-bg-playlist.spec.ts) and the measured
// black-frame gate (video-gate.spec.ts).

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/video-bg.html';

/** URLs of every MP4 the page has requested so far. */
function videoRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) urls.push(request.url());
  });
  return urls;
}

const video = (page: Page, id: string) => page.locator(`#${id} video`);
const button = (page: Page, id: string, name: RegExp) => page.locator(`#${id}`).getByRole('button', { name });
const posterOpacity = (page: Page, id: string) => page.locator(`#${id} picture`).evaluate((p) => getComputedStyle(p).opacity);
const isPlaying = (page: Page, id: string) =>
  video(page, id).evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0).catch(() => false);

test('no video byte loads before the background is within 200px of the viewport', async ({ page }) => {
  const requests = videoRequests(page);
  await page.goto(PAGE);
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);
  expect(requests.filter((u) => u.includes('/talk-')), 'the background far below the fold loaded video').toEqual([]);

  await page.locator('#talk').scrollIntoViewIfNeeded();
  await expect.poll(() => requests.some((u) => u.includes('/talk-'))).toBe(true);
});

test('the poster covers the video until a frame has painted, then fades out', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/*.mp4', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(video(page, 'bg')).toHaveCount(1);
  expect(await posterOpacity(page, 'bg'), 'the poster faded before any frame arrived').toBe('1');

  release();
  await expect.poll(() => posterOpacity(page, 'bg')).toBe('0');
  expect(await isPlaying(page, 'bg')).toBe(true);
});

const skips: [string, (page: Page) => Promise<unknown>][] = [
  ['reduced motion', (page) => page.emulateMedia({ reducedMotion: 'reduce' })],
  ['Save-Data', (page) => page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }))],
  ['a 2G connection', (page) => page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { effectiveType: 'slow-2g' } }))],
];
for (const [name, setup] of skips) {
  test(`with ${name}, no video loads, the poster stays, and no controls show`, async ({ page }) => {
    await setup(page);
    const requests = videoRequests(page);
    await page.goto(PAGE);
    await page.waitForLoadState('networkidle');
    expect(requests, 'video requests').toEqual([]);
    expect(await posterOpacity(page, 'bg')).toBe('1');
    await expect(page.locator('#bg').getByRole('button')).toHaveCount(0);
  });
}

test('when autoplay is refused, the poster stays and the button offers play', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
  });
  await page.goto(PAGE);
  await expect(video(page, 'bg')).toHaveCount(1);
  await expect(button(page, 'bg', /^Play background video$/)).toBeVisible();
  expect(await posterOpacity(page, 'bg')).toBe('1');
});

test('the pause button pauses, says play afterwards, and the pause is remembered after a reload', async ({ page }) => {
  await page.goto(PAGE);
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);

  await button(page, 'bg', /^Pause background video$/).click();
  await expect(button(page, 'bg', /^Play background video$/)).toBeVisible();
  expect(await video(page, 'bg').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  const requests = videoRequests(page);
  await page.reload();
  await expect(button(page, 'bg', /^Play background video$/)).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requests.filter((u) => u.includes('/bg-')), 'a remembered pause still loaded the video').toEqual([]);

  await button(page, 'bg', /^Play background video$/).click();
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);
});

test('it pauses when less than 10% is on screen or the tab is hidden, and resumes when both are back', async ({ page }) => {
  await page.goto(PAGE);
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);
  const paused = () => video(page, 'bg').evaluate((v: HTMLVideoElement) => v.paused);

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
  await expect.poll(paused, 'still playing offscreen').toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(paused, 'did not resume on screen').toBe(false);

  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { value: h, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect.poll(paused, 'still playing in a hidden tab').toBe(true);
  await setHidden(false);
  await expect.poll(paused, 'did not resume in a visible tab').toBe(false);
});

test("after the visitor pauses, coming back on screen does not override them", async ({ page }) => {
  await page.goto(PAGE);
  await expect.poll(() => isPlaying(page, 'bg')).toBe(true);
  await button(page, 'bg', /^Pause background video$/).click();

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);
  expect(await video(page, 'bg').evaluate((v: HTMLVideoElement) => v.paused), 'resumed against the visitor').toBe(true);
});

test('the sound button shows only for a clip that kept its audio, and its label says what it will do', async ({ page }) => {
  await page.goto(PAGE);
  await expect(button(page, 'bg', /sound/)).toBeHidden();

  await page.locator('#talk').scrollIntoViewIfNeeded();
  await expect.poll(() => isPlaying(page, 'talk')).toBe(true);
  await button(page, 'talk', /^Turn sound on$/).click();
  await expect(button(page, 'talk', /^Turn sound off$/)).toBeVisible();
  expect(await video(page, 'talk').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
});

test('the video is decorative: hidden from assistive technology, with no native controls or picture-in-picture', async ({ page }) => {
  await page.goto(PAGE);
  await expect(video(page, 'bg')).toHaveCount(1);
  const attrs = await video(page, 'bg').evaluate((v: HTMLVideoElement) => ({
    hidden: v.getAttribute('aria-hidden'),
    controls: v.controls,
    pip: v.disablePictureInPicture,
    muted: v.muted,
    inline: v.playsInline,
  }));
  expect(attrs).toEqual({ hidden: 'true', controls: false, pip: true, muted: true, inline: true });
});

test('every control is a real button at least 44 by 44 pixels', async ({ page }) => {
  await page.goto(PAGE);
  const box = await button(page, 'bg', /background video/).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
