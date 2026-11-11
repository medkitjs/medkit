// The M1 gate: <medkit-image> causes no layout shift, on a page rendered by
// renderImage() with a priority hero, an art-directed crop and lazy images
// below the fold, at desktop and phone widths.
//
// Two measurements, because only Chromium implements the Layout Instability
// API that CLS is built on:
// - CLS from web-vitals, in Chromium. Anywhere else the API is missing and
//   onCLS would never report, so a "0" there would mean nothing measured.
// - Element positions, in every engine: every element's box is recorded while
//   image responses are held back, then again after every image has loaded.
//   Any difference is a shift, whatever the engine reports.
//
// Not covered: shifts caused by the page itself (fonts, ads), which are not
// medkit's, and the hero being the largest paint, which is a budget for a
// later check.

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/layout.html';
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

/** Holds every image response until the returned function is called. */
async function holdMedia(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route('**/examples/html/media/**', async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

/** Scrolls through the page so every lazy image starts, then waits until every image has finished. */
async function loadEveryImage(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await expect
    .poll(() => page.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0)), {
      message: 'some images never loaded',
    })
    .toBe(true);
  // Back to the top, where the first boxes were recorded: adding a large
  // fractional scrollY to each top differs in the last float digits even
  // when nothing moved. One more frame, so layout reflects every image.
  await page.evaluate(() => {
    scrollTo(0, 0);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Every element's box, taken with the page scrolled to the top. */
const boxes = (page: Page) =>
  page.evaluate(() =>
    [...document.body.querySelectorAll('*')].map((el, i) => {
      const r = el.getBoundingClientRect();
      return `${i} ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${r.left},${r.top} ${r.width}×${r.height}`;
    }),
  );

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`at ${name} width`, () => {
    test.use({ viewport });

    test('no element moves or resizes when the images load', async ({ page }) => {
      const release = await holdMedia(page);
      await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
      const before = await boxes(page);

      release();
      await loadEveryImage(page);

      expect(await boxes(page), 'an element moved or resized after the images loaded').toEqual(before);
    });

    test('CLS measured by web-vitals is 0', async ({ page, browserName }) => {
      await page.goto(PAGE);
      const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'));
      if (browserName === 'chromium') expect(supported, 'Chromium stopped reporting layout-shift').toBe(true);
      test.skip(!supported, `${browserName} has no Layout Instability API, so CLS cannot be measured; the position test covers it`);

      await page.evaluate(async () => {
        const { onCLS } = await import('/node_modules/web-vitals/dist/web-vitals.js' as string);
        (window as unknown as { cls: number[] }).cls = [];
        onCLS((metric: { value: number }) => (window as unknown as { cls: number[] }).cls.push(metric.value), { reportAllChanges: true });
      });
      await loadEveryImage(page);
      // web-vitals reports the final CLS when the page is hidden.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      const reports = await page.evaluate(() => (window as unknown as { cls: number[] }).cls);
      expect(reports.length, 'web-vitals never reported CLS').toBeGreaterThan(0);
      expect(reports.at(-1), 'cumulative layout shift').toBe(0);
    });
  });
}

test('every preload media condition parses, and exactly one preload matches each width', async ({ page }) => {
  await page.goto(PAGE);
  const media = await page.$$eval('link[rel=preload]', (links) => links.map((l) => l.getAttribute('media')));
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    const matches = await page.evaluate(
      (list) => list.map((m) => (m === null ? true : matchMedia(m).media !== 'not all' && matchMedia(m).matches)),
      media,
    );
    for (const m of media.filter(Boolean)) {
      expect(await page.evaluate((q) => matchMedia(q).media, m!), `"${m}" did not parse`).not.toBe('not all');
    }
    expect(matches.filter(Boolean).length, `preloads matching at ${name} width`).toBe(1);
  }
});
