// Covers the background's expand hand-off in every engine: the player's code
// loads only on expand, the popup opens at the background's moment with the
// manifest's player set and its sound, and on close the background goes on
// from where the popup stopped, unless the visitor had paused it, with focus
// back on the expand button. A page that cancels medkit-expand gets no popup,
// and a `player` attribute holding anything renderPlayer() would not write
// opens nothing and runs nothing.
//
// Not covered here: the event's detail and the pause itself (video-bg.spec.ts),
// and the popup's own behaviour (player-popup.spec.ts).

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/video-bg.html';
const bg = (page: Page) => page.locator('#talk video');
const popup = (page: Page) => page.locator('body > medkit-player video');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Test pattern with a tone' });
const expandButton = (page: Page) => page.locator('#talk').getByRole('button', { name: 'Expand video' });
const time = (v: ReturnType<typeof bg>) => v.evaluate((v: HTMLVideoElement) => v.currentTime);

async function playingBackground(page: Page) {
  await page.goto(PAGE);
  await page.locator('#talk').scrollIntoViewIfNeeded();
  await expect.poll(() => time(bg(page)), { message: 'the background never played' }).toBeGreaterThan(1);
}

test("expand loads the player only then, and opens the clip's popup at the background's moment with sound", async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => r.url().includes('/dist/') && scripts.push(r.url().split('/dist/')[1]));
  await playingBackground(page);
  expect(scripts, 'player code before expand').not.toContain('player-element.js');

  const at = await time(bg(page));
  await expandButton(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(scripts).toContain('expand.js');
  await expect.poll(() => popup(page).evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  const state = await popup(page).evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, muted: v.muted, src: v.currentSrc }));
  expect(state.t, 'popup start vs the background').toBeGreaterThanOrEqual(at - 0.1);
  expect(state.t).toBeLessThan(at + 1.5);
  expect(state.muted, 'muted').toBe(false);
  expect(state.src, "the manifest's player set").toMatch(/talk-player/);
});

test('closing the popup resumes the background from where the popup stopped, with focus back on expand', async ({ page }) => {
  await playingBackground(page);
  await expandButton(page).click();
  await expect.poll(() => time(popup(page))).toBeGreaterThan(2.5);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  const stopped = await time(popup(page));
  await expect(expandButton(page)).toBeFocused();
  await expect.poll(() => bg(page).evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  const resumed = await time(bg(page));
  expect(resumed, 'background time after close vs where the popup stopped').toBeGreaterThanOrEqual(stopped - 0.1);
  expect(resumed).toBeLessThan(stopped + 1);
});

test('a background the visitor had paused stays paused after the popup, at the moment the popup reached', async ({ page }) => {
  await playingBackground(page);
  await page.locator('#talk').getByRole('button', { name: 'Pause background video' }).click();
  await expandButton(page).click();
  await expect.poll(() => time(popup(page))).toBeGreaterThan(2.5);
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  const stopped = await time(popup(page));
  await page.waitForTimeout(500);
  expect(await bg(page).evaluate((v: HTMLVideoElement) => v.paused), 'the background resumed').toBe(true);
  expect(Math.abs((await time(bg(page))) - stopped)).toBeLessThan(0.1);
});

test('a page that cancels medkit-expand gets the event and a paused background, but no popup', async ({ page }) => {
  await playingBackground(page);
  await page.locator('#talk medkit-video-bg').evaluate((el) => el.addEventListener('medkit-expand', (e) => e.preventDefault()));
  await expandButton(page).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await bg(page).evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('a player attribute with markup renderPlayer() would not write cannot run script: no popup opens, and the console says why', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await playingBackground(page);
  await page.locator('#talk medkit-clip').evaluate((clip) =>
    clip.setAttribute('player', '<medkit-player popup title="x"><video><source src="/a.mp4"></video><img src="/missing.png" onerror="window.pwned = 1"></medkit-player>'),
  );
  await expandButton(page).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned), 'the injected handler ran').toBeUndefined();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(warnings.join('\n')).toContain("the clip's player attribute is not what renderVideoBg() writes");
});
