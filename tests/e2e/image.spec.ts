// Covers <medkit-image> in every engine: the fade over the placeholder, which
// images are never hidden (priority, reduced motion, broken), the page without
// JavaScript, and each development warning.
//
// Not covered here: layout shift and the markup renderImage() writes, which
// layout.spec.ts and the SSR unit tests cover.

import { expect, test, type Page } from '@playwright/test';

/**
 * Holds every response under /media/ until the returned function is called.
 * Pages are then opened with `waitUntil: 'domcontentloaded'`, because the load
 * event waits for the held images. Module scripts have run by then.
 */
async function holdMedia(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route('**/examples/html/media/**', async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

const opacity = (page: Page, id: string) =>
  page.locator(`#${id} img`).evaluate((img) => getComputedStyle(img).opacity);
const background = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);

test('a lazy image fades in over its placeholder, and the placeholder is gone once it has loaded', async ({ page }) => {
  const release = await holdMedia(page);
  await page.goto('/examples/html/image.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  expect(await opacity(page, 'lazy'), 'a loading image should be hidden under its placeholder').toBe('0');

  release();
  await expect.poll(() => opacity(page, 'lazy')).toBe('1');
  await expect.poll(() => background(page, 'lazy'), 'the placeholder stayed behind the image').toBe('rgba(0, 0, 0, 0)');
});

test('a priority image is never hidden, even while it is still loading', async ({ page }) => {
  const release = await holdMedia(page);
  await page.goto('/examples/html/image.html', { waitUntil: 'domcontentloaded' });
  expect(await opacity(page, 'hero')).toBe('1');
  release();
});

test('with reduced motion, no image is ever hidden behind a fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const release = await holdMedia(page);
  await page.goto('/examples/html/image.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  expect(await opacity(page, 'lazy')).toBe('1');
  release();
  await expect.poll(() => background(page, 'lazy'), 'the placeholder stayed behind the image').toBe('rgba(0, 0, 0, 0)');
});

test('a broken image stays visible, so its alt text can be read', async ({ page }) => {
  await page.goto('/examples/html/image.html');
  await page.waitForLoadState('load');
  expect(await opacity(page, 'broken')).toBe('1');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every image still loads and shows', async ({ page }) => {
    await page.goto('/examples/html/image.html');
    await page.waitForLoadState('load');
    const hero = page.locator('#hero img');
    expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth), 'the hero did not load').toBeGreaterThan(0);
    await expect(hero).toBeVisible();
  });
});

test('the development build warns about each mistake on the page', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto('/examples/html/image-dev.html');
  await page.waitForLoadState('load');

  const expected = [
    'has no alt',
    'has no width or height',
    'appears 2 times with priority',
    'downloads a 1200px file',
    'has no <img> inside',
  ];
  const lcpSupported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint'));
  if (lcpSupported) expected.push('is not the largest paint');

  for (const text of expected) {
    await expect.poll(() => warnings.some((w) => w.includes(text)), `no warning containing "${text}"`).toBe(true);
  }
});
