// Covers <medkit-player popup> in every engine: the thumbnail taking the
// video's box without moving the page, opening into a native modal dialog
// that plays and focuses the pause button, focus and scroll held while open,
// the three ways to close and where focus returns, the events, keys doing
// nothing while closed, and axe with the dialog open.
//
// Not covered here: the background's expand opening this popup
// (video-bg-expand.spec.ts).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/player.html';
const host = (page: Page) => page.locator('#popup medkit-player');
const thumb = (page: Page) => host(page).getByRole('button', { name: 'Play Talk in a popup, 0:06' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Talk in a popup' });
const paused = (page: Page) => page.locator('#popup video').evaluate((v: HTMLVideoElement) => v.paused);

test('the thumbnail takes the box the video had without JavaScript, so nothing after it moves', async ({ browser }) => {
  // From the popup's own top, so a change above it cannot count here.
  const below = async (javaScriptEnabled: boolean) => {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    await page.goto(PAGE);
    if (javaScriptEnabled) await expect(thumb(page)).toBeVisible();
    const y = await page.evaluate(() => document.querySelector('#after')!.getBoundingClientRect().top - document.querySelector('#popup')!.getBoundingClientRect().top);
    await context.close();
    return y;
  };
  expect(Math.abs((await below(true)) - (await below(false))), 'px the text after the popup moved').toBeLessThanOrEqual(0.5);
});

test('the thumbnail opens a modal dialog that plays, with focus on the pause button, and the page cannot scroll behind it', async ({ page }) => {
  await page.goto(PAGE);
  const opened = page.evaluate(() => new Promise((r) => document.querySelector('#popup medkit-player')!.addEventListener('medkit-popupopen', r, { once: true })));
  await thumb(page).click();
  await opened;
  await expect(dialog(page)).toBeVisible();
  await expect.poll(() => paused(page)).toBe(false);
  await expect(dialog(page).getByRole('button', { name: 'Pause' })).toBeFocused();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY), 'the page scrolled behind the popup').toBe(before);
});

test('focus never reaches the page behind the open popup', async ({ page }) => {
  await page.goto(PAGE);
  await thumb(page).click();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    // body is the browser's own UI, which a modal dialog lets focus visit
    // between rounds; anything else outside the popup is the page behind it.
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return el === document.body || el?.closest('#popup medkit-player') ? 'ok' : `${el?.localName}#${el?.id}`;
    });
    expect(where, `focus after ${i + 1} Tabs`).toBe('ok');
  }
});

for (const [how, close] of [
  ['Esc', (page: Page) => page.keyboard.press('Escape')],
  ['the close button', (page: Page) => dialog(page).getByRole('button', { name: 'Close' }).click()],
  ['a click on the backdrop', (page: Page) => page.mouse.click(5, 5)],
] as const) {
  test(`${how} closes the popup, pauses it, returns focus to the thumbnail, and says where it stopped`, async ({ page }) => {
    await page.goto(PAGE);
    await thumb(page).click();
    await expect.poll(() => page.locator('#popup video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
    const closed = page.evaluate(
      () => new Promise<number>((r) => document.querySelector('#popup medkit-player')!.addEventListener('medkit-popupclose', (e) => r((e as CustomEvent).detail.currentTime), { once: true })),
    );
    await close(page);
    expect(await closed, 'currentTime in medkit-popupclose').toBeGreaterThan(0);
    await expect(dialog(page)).toBeHidden();
    expect(await paused(page)).toBe(true);
    await expect(thumb(page)).toBeFocused();
  });
}

test('while the popup is closed, its thumbnail is only a button: player keys do nothing', async ({ page }) => {
  await page.goto(PAGE);
  await thumb(page).focus();
  await page.keyboard.press('k');
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('#popup video').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, t: v.currentTime }))).toEqual({ paused: true, t: 0 });
});

test('the open popup has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto(PAGE);
  await thumb(page).click();
  await expect(dialog(page)).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`), 'axe violations').toEqual([]);
});
