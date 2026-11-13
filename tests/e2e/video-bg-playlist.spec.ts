// Covers the <medkit-video-bg> playlist in every engine: Previous/Next with the
// position, seen as "1 / 3" and heard as "1 of 3", inert inactive overlays, announcements on manual changes only,
// auto-advance and pausing it, the crossfade order, preloading at 75%, the
// clipchange event, and the pause button only clips under 5 seconds may drop.
//
// Not covered here: single-clip behaviour (video-bg.spec.ts) and the measured
// black-frame gate (video-gate.spec.ts).

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/video-bg-playlist.html';

const bg = (page: Page, id: string) => page.locator(`#${id}`);
const position = (page: Page, id: string) => bg(page, id).locator('span[aria-hidden=true]');
const status = (page: Page, id: string) => bg(page, id).locator('[role=status]');
const activeIndex = (page: Page, id: string) =>
  page.locator(`#${id} medkit-clip`).evaluateAll((clips) => clips.findIndex((c) => !(c as HTMLElement).inert));

test('Next and Previous move through the clips with the position shown, wrapping at both ends', async ({ page }) => {
  await page.goto(PAGE);
  await expect(position(page, 'list')).toHaveText('1 / 3');

  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  await expect(position(page, 'list')).toHaveText('2 / 3');
  await bg(page, 'list').getByRole('button', { name: 'Previous video' }).click();
  await bg(page, 'list').getByRole('button', { name: 'Previous video' }).click();
  await expect(position(page, 'list')).toHaveText('3 / 3');
  expect(await activeIndex(page, 'list')).toBe(2);
});

test('screen readers hear the position as "1 of 3", while "1 / 3" is only seen', async ({ page }) => {
  await page.goto(PAGE);
  const controls = bg(page, 'list').locator('[part=controls]');
  await expect(controls, 'what a screen reader meets in the controls').toMatchAriaSnapshot(`
    - button "Previous video"
    - text: 1 of 3
    - button "Next video"
  `);
  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  await expect(controls).toMatchAriaSnapshot(`
    - button "Previous video"
    - text: 2 of 3
    - button "Next video"
  `);
});

test("only the active clip's overlay can take focus; inactive overlays are inert", async ({ page }) => {
  await page.goto(PAGE);
  // Browsers leave inert content out of the accessibility tree as well, which
  // Playwright cannot observe; focus is the part it can.
  const focusable = (i: number) =>
    page.locator('#list a').nth(i).evaluate((a: HTMLElement) => {
      a.focus();
      return document.activeElement === a;
    });
  expect(await focusable(0), 'the active overlay').toBe(true);
  expect(await focusable(1), 'an inactive overlay took focus').toBe(false);

  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  expect(await focusable(1), 'the new active overlay').toBe(true);
  expect(await focusable(0), 'the old overlay still takes focus').toBe(false);
});

test('a manual change is announced politely, with the clip title and position', async ({ page }) => {
  await page.goto(PAGE);
  await expect(status(page, 'list')).toHaveText('');
  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  await expect(status(page, 'list')).toHaveText('Test pattern with a tone, 2 of 3');
});

test('auto-advance moves on when a clip ends, and is never announced', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#auto').scrollIntoViewIfNeeded();
  await expect.poll(() => activeIndex(page, 'auto'), { timeout: 10_000 }).toBe(1);
  await expect(status(page, 'auto')).toHaveText('');
});

test('without autoadvance, each clip loops instead of ending', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#list video')).toHaveCount(1);
  expect(await page.locator('#list video').evaluate((v: HTMLVideoElement) => v.loop)).toBe(true);
});

test('pausing stops auto-advance', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#auto').scrollIntoViewIfNeeded();
  await expect(page.locator('#auto video')).toHaveCount(1);
  await bg(page, 'auto').getByRole('button', { name: 'Pause background video' }).click();
  await page.waitForTimeout(3500);
  expect(await activeIndex(page, 'auto')).toBe(0);
});

test('the incoming clip fades in on top while the outgoing one stays opaque beneath it', async ({ page }) => {
  await page.goto(PAGE);
  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  const [outgoing, incoming] = await page.locator('#list medkit-clip').evaluateAll((clips) =>
    clips.slice(0, 2).map((c) => ({ opacity: getComputedStyle(c).opacity, z: getComputedStyle(c).zIndex })),
  );
  expect(outgoing.opacity, 'the outgoing clip faded while the new one was still transparent').toBe('1');
  expect(incoming.z).toBe('1');
  await expect.poll(() => page.locator('#list medkit-clip').first().evaluate((c) => getComputedStyle(c).opacity)).toBe('0');
});

test("at 75% of a clip, the next clip's video starts loading", async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => r.url().includes('/short-b-') && r.url().endsWith('.mp4') && requests.push(r.url()));
  await page.goto(PAGE);
  await page.locator('#auto').scrollIntoViewIfNeeded();
  const progress = () => page.locator('#auto video').first().evaluate((v: HTMLVideoElement) => v.currentTime / v.duration);
  await expect.poll(progress).toBeGreaterThan(0.1);
  expect(await progress() < 0.75 ? requests : [], 'the next clip loaded before 75%').toEqual([]);
  await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('every change fires medkit-clipchange with the new index', async ({ page }) => {
  await page.goto(PAGE);
  const changed = page.locator('#list medkit-video-bg').evaluate(
    (el) => new Promise((resolve) => el.addEventListener('medkit-clipchange', (e) => resolve((e as CustomEvent).detail.index), { once: true })),
  );
  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  expect(await changed).toBe(1);
});

test('the pause button can be left out only when every clip is under 5 seconds', async ({ page }) => {
  await page.goto(PAGE);
  await expect(bg(page, 'short').getByRole('button', { name: /background video/ }), 'clips under 5s may drop pause').toBeHidden();
  await expect(bg(page, 'list').getByRole('button', { name: /background video/ }), 'a 6s clip must keep pause').toBeVisible();
});

test('with reduced motion, the posters still change with Previous and Next, at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(PAGE);
  await bg(page, 'list').getByRole('button', { name: 'Next video' }).click();
  await expect(position(page, 'list')).toHaveText('2 / 3');
  expect(await page.locator('#list medkit-clip').first().evaluate((c) => getComputedStyle(c).opacity), 'faded instead of cutting').toBe('0');
  await expect(page.locator('#list video')).toHaveCount(0);
});
