// Covers the YouTube and Vimeo facades in every engine: nothing from the
// provider before a click but a preconnect on hover or focus, the iframe
// with autoplay, a title and focus, in the thumbnail's box or in the popup,
// closing the popup stops it, and the link that works with no JavaScript.
// Provider requests are answered locally, so no test depends on YouTube or
// Vimeo being reachable.
//
// Not covered: playback inside the providers' players, which is theirs.

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/player-embed.html';
const PROVIDERS = /^https:\/\/([^/]*\.)?(youtube|youtube-nocookie|ytimg|vimeo|vimeocdn)\.com\//;

/** Answers every provider request with an empty page, and records the URLs. */
async function stubProviders(page: Page) {
  const asked: string[] = [];
  await page.route(PROVIDERS, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title><button>inside</button>' });
  });
  return asked;
}

const iframe = (page: Page, id: string) => page.locator(`#${id} iframe`);
const focusedInPlayer = (page: Page, id: string) =>
  page.evaluate((id) => {
    const host = document.querySelector(`#${id} medkit-player`)!;
    return document.activeElement === host ? host.shadowRoot!.activeElement?.localName : document.activeElement?.localName;
  }, id);

test('nothing loads from YouTube before the click, apart from a preconnect once the button is hovered', async ({ page }) => {
  const asked = await stubProviders(page);
  await page.goto(PAGE);
  await page.waitForLoadState('networkidle');
  expect(asked, 'provider requests before any interaction').toEqual([]);
  expect(await page.locator('link[rel=preconnect]').count()).toBe(0);
  await page.locator('#youtube').getByRole('button', { name: 'Play A YouTube video' }).hover();
  await expect(page.locator('link[rel=preconnect][href="https://www.youtube-nocookie.com"]')).toHaveCount(1);
  expect(asked, 'provider requests after hovering').toEqual([]);
});

test('a click loads the privacy-enhanced YouTube player with autoplay and a title, in the box the thumbnail had, with focus in it', async ({ page }) => {
  const asked = await stubProviders(page);
  await page.goto(PAGE);
  const button = page.locator('#youtube').getByRole('button', { name: 'Play A YouTube video' });
  const box = await button.boundingBox();
  await button.click();
  await expect(iframe(page, 'youtube')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1');
  await expect(iframe(page, 'youtube')).toHaveAttribute('title', 'A YouTube video');
  const frame = await iframe(page, 'youtube').boundingBox();
  expect(Math.abs(frame!.height - box!.height), 'px the box changed').toBeLessThanOrEqual(1);
  expect(await focusedInPlayer(page, 'youtube')).toBe('iframe');
  expect(asked.some((u) => u.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'))).toBe(true);
});

test('in a popup, Vimeo opens in the dialog and closing it removes the player, which stops it, and returns focus', async ({ page }) => {
  await stubProviders(page);
  await page.goto(PAGE);
  const button = page.locator('#vimeo').getByRole('button', { name: 'Play A Vimeo video' });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'A Vimeo video' });
  await expect(dialog).toBeVisible();
  await expect(iframe(page, 'vimeo')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871?autoplay=1');
  expect(await focusedInPlayer(page, 'vimeo')).toBe('iframe');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(iframe(page, 'vimeo')).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('without JavaScript, each facade is a link to the video on its provider', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PAGE);
  await expect(page.locator('#youtube').getByRole('link', { name: 'A YouTube video' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.locator('#vimeo').getByRole('link', { name: 'A Vimeo video' })).toHaveAttribute('href', 'https://vimeo.com/76979871');
  await context.close();
});
