// Covers the built docs site as GitHub Pages serves it, under /medkit/, in
// every engine: every page loads with no error and no failed request, has no
// WCAG 2.2 AA violations in light and dark, does not scroll sideways on a
// phone, and causes no layout shift (Chromium); search finds a page.
//
// Not covered: whether the prose is right, which a reader checks; the live
// previews' behaviour, which is code-preview-element's own, beyond axe finding
// nothing wrong in them; and Starlight's search button, excluded from axe
// below, whose name leaves out the shortcut it shows.

import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const DIST = resolve(import.meta.dirname, '../../docs/dist');
const pages = (readdirSync(DIST, { recursive: true }) as string[])
  .filter((f) => f.endsWith('index.html') && !f.startsWith('_astro'))
  .map((f) => relative('.', f.split(sep).join('/')).replace(/index\.html$/, ''))
  .sort();

test('the build has every section of the docs', () => {
  for (const section of ['getting-started/astro/', 'elements/image/', 'processing/cli/', 'guides/translations/', 'reference/manifest/']) {
    expect(pages, 'a page missing from the build').toContain(section);
  }
});

for (const path of pages) {
  test(`/medkit/${path} loads with no error, and has no WCAG 2.2 AA violations in light or dark`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    expect((await page.goto(path))?.ok(), 'the page itself').toBe(true);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);

    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        // Starlight's own search button: aria-label "Search" while its visible
        // text also shows the shortcut (label-content-name-mismatch). Not ours
        // to fix in its markup; every other node is checked.
        .exclude('button[data-open-modal]')
        .analyze();
      expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), `axe violations in ${theme}`).toEqual([]);
    }
  });
}

test('no page scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of pages) {
    await page.goto(path);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide, `/medkit/${path} is wider than the screen`).toBeLessThanOrEqual(0);
  }
});

test('the home page and the element pages cause no layout shift', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium has the Layout Instability API that CLS needs');
  const script = (await import('node:fs/promises')).readFile(join(import.meta.dirname, '../../node_modules/web-vitals/dist/web-vitals.iife.js'), 'utf8');
  await page.addInitScript({ content: `${await script}\nwindow.webVitals = webVitals;` });
  await page.addInitScript(() => {
    const w = window as unknown as { cls: number[]; webVitals: { onCLS: (cb: (m: { value: number }) => void, o: object) => void } };
    w.cls = [];
    addEventListener('DOMContentLoaded', () => w.webVitals.onCLS((metric) => w.cls.push(metric.value), { reportAllChanges: true }));
  });
  for (const path of ['', 'elements/image/', 'elements/video-bg/', 'elements/player/']) {
    // Tall enough to hold the page: CLS counts only shifts inside the viewport.
    await page.setViewportSize({ width: 1280, height: 9000 });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollHeight), `/medkit/${path} fits the viewport`).toBeLessThanOrEqual(9000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const reports = await page.evaluate(() => (window as unknown as { cls: number[] }).cls);
    expect(reports.at(-1) ?? 0, `cumulative layout shift on /medkit/${path}`).toBe(0);
  }
});

test('search finds the page about a term', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /search/i }).first().click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Search' }).fill('poster');
  await expect(page.getByRole('dialog').getByRole('link', { name: /video-bg/i }).first()).toBeVisible();
});
