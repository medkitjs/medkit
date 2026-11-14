// Covers <medkit-player> in every engine on pages rendered by renderPlayer():
// the control bar replacing native controls, every control's name and size,
// the keyboard map and that it applies only with focus inside, the seek bar's
// spoken value, captions, speed, mute and volume, the bar hiding during
// playback and when it never does, fullscreen, audio mode, and the development
// build's warning for a video with sound and no captions.
//
// Not covered here: picture-in-picture beyond its button (headless browsers
// differ in whether they grant it), iPhone's native fullscreen fallback (the
// M3 iPhone checklist), and what the bar looks like.

import { expect, test, type Page } from '@playwright/test';

const PAGE = '/examples/html/player.html';
const host = (page: Page, id = 'inline') => page.locator(`#${id} medkit-player`);
const media = (page: Page, id = 'inline') => page.locator(`#${id} video, #${id} audio`);
const button = (page: Page, name: string | RegExp, id = 'inline') => host(page, id).getByRole('button', { name });
const state = (page: Page, id = 'inline') =>
  media(page, id).evaluate((m: HTMLMediaElement) => ({ paused: m.paused, time: m.currentTime, muted: m.muted, volume: m.volume, rate: m.playbackRate }));

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(button(page, 'Play')).toBeVisible();
});

test('the native controls give way to a bar of real controls, each at least 44 by 44 pixels', async ({ page }) => {
  expect(await media(page).evaluate((v: HTMLVideoElement) => v.controls), 'native controls').toBe(false);
  for (const name of ['Play', 'Mute', 'Full screen']) await expect(button(page, name)).toBeVisible();
  await expect(host(page).getByRole('slider', { name: 'Seek' })).toBeVisible();
  await expect(host(page).getByRole('slider', { name: 'Volume' })).toBeVisible();
  await expect(host(page).getByRole('combobox', { name: 'Captions' })).toBeVisible();
  await expect(host(page).getByRole('combobox', { name: 'Speed' })).toBeVisible();
  const small = await host(page).evaluate((el) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>('button:not([hidden]), select:not([hidden])')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width < 44 || r.height < 44).length,
  );
  expect(small, 'controls smaller than 44 by 44').toBe(0);
});

test('the play button plays and pauses, says what it will do, and a click on the video does the same', async ({ page }) => {
  await button(page, 'Play').click();
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
  await expect(button(page, 'Pause')).toBeVisible();
  await media(page).click();
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
  await expect(host(page), 'a click on the video moves focus into the player, so the keys work').toBeFocused();
});

test('the seek bar reads as "current of duration", and the arrow, J, L, Home, End and digit keys move through the video', async ({ page }) => {
  const seek = host(page).getByRole('slider', { name: 'Seek' });
  await expect(seek).toHaveAttribute('aria-valuetext', /^0:00 of 0:06$/);
  await button(page, 'Mute').focus();
  const at = async (key: string, expected: number) => {
    await page.keyboard.press(key);
    await expect.poll(() => state(page).then((s) => Math.round(s.time)), `after ${key}`).toBe(expected);
  };
  await at('ArrowRight', 5);
  await at('ArrowLeft', 0);
  await at('l', 6);
  await at('j', 0);
  await at('5', 3);
  await at('End', 6);
  await at('Home', 0);
  await page.keyboard.press('3');
  await expect(seek).toHaveAttribute('aria-valuetext', /^0:01 of 0:06$/);
});

test('shortcuts apply only while focus is inside the player', async ({ page }) => {
  await page.locator('h1').click();
  await page.keyboard.press('k');
  await page.keyboard.press('m');
  expect(await state(page), 'nothing changed from a key pressed outside').toMatchObject({ paused: true, muted: false });
  await button(page, 'Full screen').focus();
  await page.keyboard.press('m');
  await expect.poll(() => state(page).then((s) => s.muted)).toBe(true);
});

test('Space or K plays and pauses, but Space on a focused button presses that button', async ({ page }) => {
  await host(page).getByRole('slider', { name: 'Seek' }).focus();
  await page.keyboard.press('k');
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
  await page.keyboard.press(' ');
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
  await button(page, 'Mute').focus();
  await page.keyboard.press(' ');
  await expect.poll(() => state(page)).toMatchObject({ muted: true, paused: true });
  await expect(button(page, 'Unmute')).toBeFocused();
});

test('mute, M and the arrow keys change the sound, and the volume slider follows', async ({ page }) => {
  const volume = host(page).getByRole('slider', { name: 'Volume' });
  await button(page, 'Mute').click();
  await expect(button(page, 'Unmute')).toBeVisible();
  await expect(volume).toHaveValue('0');
  await page.keyboard.press('m');
  await expect(button(page, 'Mute')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  // WebKit keeps volume as a 32-bit float: 0.949999988…
  await expect.poll(() => state(page).then((s) => Math.round(s.volume * 100))).toBe(95);
  expect(Number(await volume.inputValue())).toBeCloseTo(0.95);
});

test('captions are chosen from a menu, and C turns the last one chosen off and on again', async ({ page }) => {
  const menu = host(page).getByRole('combobox', { name: 'Captions' });
  const showing = () => media(page).evaluate((v: HTMLVideoElement) => [...v.textTracks].filter((t) => t.mode === 'showing').map((t) => t.label));
  await expect(menu.locator('option')).toHaveText(['Off', 'English', 'Srpski']);
  await menu.selectOption({ label: 'Srpski' });
  await expect.poll(showing).toEqual(['Srpski']);
  await button(page, 'Play').focus();
  await page.keyboard.press('c');
  await expect.poll(showing).toEqual([]);
  await expect(menu).toHaveValue('-1');
  await page.keyboard.press('c');
  await expect.poll(showing).toEqual(['Srpski']);
});

test('speed is chosen from 0.5× to 2×, and Shift with < or > steps through it', async ({ page }) => {
  const menu = host(page).getByRole('combobox', { name: 'Speed' });
  await expect(menu.locator('option')).toHaveText(['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×']);
  await menu.selectOption('1.5');
  await expect.poll(() => state(page).then((s) => s.rate)).toBe(1.5);
  await button(page, 'Play').focus();
  await page.keyboard.press('Shift+>');
  await expect.poll(() => state(page).then((s) => s.rate)).toBe(2);
  await page.keyboard.press('Shift+>');
  await page.keyboard.press('Shift+<');
  await expect(menu).toHaveValue('1.5');
});

test('during playback the bar fades after 2.5 seconds, never while focus is in it, and comes back on pointer movement', async ({ page }) => {
  const bar = host(page).locator('[part=controls]');
  const idle = () => bar.evaluate((b) => b.classList.contains('idle'));
  await button(page, 'Play').click();
  await page.waitForTimeout(3000);
  expect(await idle(), 'faded with focus on the play button').toBe(false);
  await page.locator('h1').click();
  await media(page).evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(idle, { timeout: 5000 }).toBe(true);
  await media(page).hover();
  await page.mouse.move(100, 300);
  await media(page).hover({ position: { x: 10, y: 10 } });
  expect(await idle(), 'still faded after the pointer moved').toBe(false);
});

test('fullscreen puts the whole player on screen, controls included, and the button then exits it', async ({ page }) => {
  await button(page, 'Full screen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.localName)).toBe('medkit-player');
  await button(page, 'Exit full screen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
});

test('around <audio> the bar is compact and always shown, with no fullscreen or picture-in-picture', async ({ page }) => {
  await expect(button(page, 'Play', 'audio')).toBeVisible();
  await expect(button(page, 'Full screen', 'audio')).toHaveCount(0);
  await expect(button(page, 'Picture in picture', 'audio')).toHaveCount(0);
  await button(page, 'Play', 'audio').click();
  await page.locator('h1').click();
  await page.waitForTimeout(3000);
  expect(await host(page, 'audio').locator('[part=controls]').evaluate((b) => b.classList.contains('idle'))).toBe(false);
});

test('the development build warns about a video with sound and no captions track, and only about that one', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  // Both pages load player.js; here it hands over to the development build.
  await page.route('**/packages/elements/dist/player.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "import './player-dev.js';" }));
  await page.goto('/examples/html/player.html');
  await expect(button(page, 'Play')).toBeVisible();
  expect(warnings.filter((w) => w.includes('no captions')), 'warnings on a page whose videos all have captions').toEqual([]);
  await page.goto('/examples/html/player-hls.html');
  await expect(button(page, 'Play')).toBeVisible();
  await expect.poll(() => warnings.filter((w) => w.includes('a video with sound and no captions track')).length).toBe(1);
});
