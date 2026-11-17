// Covers the 44 × 44 px touch target at phone width (390 × 844), in every
// engine: every visible control of every player (video, audio, popup
// thumbnail, YouTube and Vimeo facades), of the open popup, and of every
// background, on each fixture page that has them.
//
// Not covered here: desktop widths (player.spec.ts and video-bg.spec.ts check
// the bar there), and any hit area larger than a control's drawn box, which
// would pass a real thumb but is not what this measures.

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * Each visible control medkit drew, named and sized for the failure message.
 * Only shadow-root controls: what a page slots into an element (the fixture's
 * overlay links) is the page's own to size.
 */
function measure(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('medkit-player, medkit-video-bg')]
      .flatMap((host) => [...(host.shadowRoot?.querySelectorAll<HTMLElement>('button, input, select, a[href]') ?? [])])
      .filter((c) => c.checkVisibility())
      .map((c) => ({ name: c.getAttribute('aria-label') || c.textContent!.trim() || c.localName, ...c.getBoundingClientRect().toJSON() })),
  );
}

function tooSmall(found: Awaited<ReturnType<typeof measure>>) {
  return found.filter((c) => c.width < 44 || c.height < 44).map((c) => `${c.name} ${c.width}×${c.height}`);
}

async function upgraded(page: Page) {
  await page.evaluate(() => Promise.all(['medkit-player', 'medkit-video-bg'].map((tag) => (document.querySelector(tag) ? customElements.whenDefined(tag) : null))));
}

for (const file of ['player.html', 'player-embed.html', 'video-bg.html', 'video-bg-playlist.html']) {
  test(`at phone width, every control on ${file} is at least 44 by 44 pixels`, async ({ page }) => {
    await page.goto(`/examples/html/${file}`);
    await upgraded(page);
    const found = await measure(page);
    expect(found.length, 'controls found to measure').toBeGreaterThan(0);
    expect(tooSmall(found), 'controls smaller than 44 by 44').toEqual([]);
  });
}

test('at phone width, every control in the open popup is at least 44 by 44 pixels', async ({ page }) => {
  await page.goto('/examples/html/player.html');
  await upgraded(page);
  await page.locator('#popup medkit-player').getByRole('button', { name: /^Play Talk in a popup/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Talk in a popup' });
  await expect(dialog).toBeVisible();
  const found = await measure(page);
  expect(found.length, 'controls found to measure').toBeGreaterThan(0);
  expect(tooSmall(found), 'controls smaller than 44 by 44').toEqual([]);
});
