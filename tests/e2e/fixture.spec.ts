// Covers the fixture pages in every engine: the built element modules load
// without errors, every file a page requests exists, and axe finds no WCAG 2.2
// AA violations.
//
// Not covered here: element behaviour, which each element's own spec file
// covers.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the fixture page loads every element module without an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => errors.push(`failed to load ${request.url()}`));

  const response = await page.goto('/examples/html/');
  expect(response?.ok(), 'the fixture page itself did not load').toBe(true);
  await page.waitForLoadState('networkidle');

  expect(errors, 'errors while loading the fixture page').toEqual([]);
});

// image-dev.html is left out: its images are broken on purpose.
for (const path of ['', 'image.html', 'image-cdn.html', 'video-bg.html', 'video-bg-playlist.html', 'video-bg-intro.html']) {
  test(`/examples/html/${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(`/examples/html/${path}`);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.help}`), 'axe violations').toEqual([]);
  });
}

// image.html's missing.jpg is broken on purpose, to test the broken-image path.
for (const path of ['', 'image.html', 'image-dev.html', 'image-cdn.html', 'layout.html', 'video-bg.html', 'video-bg-playlist.html', 'video-bg-intro.html']) {
  test(`/examples/html/${path} requests no file that does not exist`, async ({ page }) => {
    const missing: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/missing.jpg')) missing.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`/examples/html/${path}`);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    await page.waitForLoadState('networkidle');
    expect(missing, 'requests that failed').toEqual([]);
  });
}
