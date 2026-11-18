// Covers each example app as a visitor gets it from its production server, in
// every engine: the page and everything it requests load without an error, all
// three elements upgrade, axe finds no WCAG 2.2 AA violations, and in Chromium
// the cumulative layout shift is 0.
//
// Not covered: element behaviour (playback, controls, keyboard), which the
// specs in tests/e2e cover against the fixture pages, and layout shift outside
// Chromium, which has no Layout Instability API; tests/e2e/layout.spec.ts
// compares element positions in every engine instead.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Scrolls to the bottom and back, so every lazy image and the player come into view. */
async function visitAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await page.waitForLoadState('networkidle');
}

test('the page and every file it requests load without an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  expect((await page.goto('/'))?.ok(), 'the page itself').toBe(true);
  await visitAll(page);
  expect(errors).toEqual([]);
});

test('the image, the background video and the player all upgrade', async ({ page }) => {
  await page.goto('/');
  await visitAll(page);
  await expect(page.locator('medkit-image img'), 'the image').toHaveJSProperty('complete', true);
  expect(await page.$eval('medkit-image img', (img: HTMLImageElement) => img.naturalWidth), 'the image decoded').toBeGreaterThan(0);
  await expect(page.locator('medkit-video-bg').getByRole('button', { name: /pause|play/i }), 'the background pause button').toBeVisible();
  await expect(page.locator('medkit-player').getByRole('button', { name: /^play/i }).first(), 'the player bar').toBeAttached();
});

test('the page has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/');
  await visitAll(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`), 'axe violations').toEqual([]);
});

test('the cumulative layout shift is 0', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium has the Layout Instability API that CLS needs');
  // The script build, which web-vitals does not list in its exports. Its
  // top-level `var` is made global by hand: an init script may run in its own scope.
  const script = await readFile(resolve(import.meta.dirname, '../../node_modules/web-vitals/dist/web-vitals.iife.js'), 'utf8');
  await page.addInitScript({ content: `${script}\nwindow.webVitals = webVitals;` });
  await page.addInitScript(() => {
    const w = window as unknown as { cls: number[]; webVitals: { onCLS: (cb: (m: { value: number }) => void, o: object) => void } };
    w.cls = [];
    addEventListener('DOMContentLoaded', () => w.webVitals.onCLS((metric) => w.cls.push(metric.value), { reportAllChanges: true }));
  });
  // Tall enough to hold the whole page: CLS counts only shifts inside the
  // viewport, and while scrolling, Chromium's scroll anchoring hides a shift
  // below the fold (an image without dimensions passed the scrolling version).
  await page.setViewportSize({ width: 1280, height: 3000 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.scrollHeight), 'the page fits the viewport, so every shift counts').toBeLessThanOrEqual(3000);
  // web-vitals reports the final CLS when the page is hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const reports = await page.evaluate(() => (window as unknown as { cls: number[] }).cls);
  expect(reports.length, 'web-vitals never reported CLS').toBeGreaterThan(0);
  expect(reports.at(-1), 'cumulative layout shift').toBe(0);
});
