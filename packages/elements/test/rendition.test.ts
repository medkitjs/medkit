// Covers pickRendition(): the size-based choice, and how the downlink and the
// poster's download each step it down. Not covered: where the two estimates
// come from in a browser, which tests/e2e/video-bg-start.spec.ts covers.

import { expect, test } from 'vitest';
import { pickRendition } from '../src/rendition.js';

const ladder = [
  { width: 854, height: 480, kbps: 700 },
  { width: 1280, height: 720, kbps: 1400 },
  { width: 1920, height: 1080, kbps: 2800 },
];
const height = (w: number, h: number, poster?: number, downlink?: number) => pickRendition(ladder, w, h, poster, downlink)?.height;

test('with no estimate, the smallest rendition that covers the box plays, or the largest when none does', () => {
  expect(height(1200, 700), 'a 1200 × 700 box').toBe(720);
  expect(height(3840, 2160), 'a box larger than every rendition').toBe(1080);
});

test('the downlink steps down to the largest rendition it sustains, and below the smallest rules video out', () => {
  expect(height(1900, 1000, undefined, 1500), 'a 1.5 Mbps downlink').toBe(720);
  expect(height(1900, 1000, undefined, 800), 'a 0.8 Mbps downlink').toBe(480);
  expect(height(1900, 1000, undefined, 600), 'video on a downlink below the smallest rendition').toBeUndefined();
});

test('the poster estimate steps down at most one rung, and never rules video out', () => {
  expect(height(1900, 1000, 414), 'a 414 kbps poster estimate under a 1080p choice').toBe(720);
  expect(height(800, 400, 100), 'a 100 kbps poster estimate under a 480p choice').toBe(480);
  expect(height(1900, 1000, 5000), 'a fast poster estimate').toBe(1080);
});

test('the poster estimate counts its one rung from the size-based choice, not from where the downlink left it', () => {
  expect(height(1900, 1000, 414, 1500), 'both estimates under a 1080p choice').toBe(720);
  expect(height(1900, 1000, 414, 800), 'a downlink that already stepped down two rungs').toBe(480);
});
