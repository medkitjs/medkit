// Covers pickWidths, which both processImage() and the CDN loaders use to pick
// the widths of a srcset.
//
// Not covered: whether those files exist, which core's tests check.

import { describe, expect, test } from 'vitest';
import { pickWidths } from '../src/widths.js';

describe('widths', () => {
  test('only widths up to the original are kept', () => {
    expect(pickWidths([320, 640, 960, 1280, 1920, 2560], 1000)).toEqual([320, 640, 960]);
  });

  test('the original width is added when it is at least 15% wider than the largest kept', () => {
    expect(pickWidths([320, 640, 960, 1280, 1920, 2560], 1600), '1600 is 25% over 1280').toEqual([320, 640, 960, 1280, 1600]);
    expect(pickWidths([320, 640, 960, 1280, 1920, 2560], 1400), '1400 is 9% over 1280').toEqual([320, 640, 960, 1280]);
  });

  test('a source wider than every configured width is capped at the largest', () => {
    expect(pickWidths([320, 640, 960, 1280, 1920, 2560], 6000)).toEqual([320, 640, 960, 1280, 1920, 2560]);
  });

  test('a source narrower than every configured width keeps its own width', () => {
    expect(pickWidths([320, 640], 200)).toEqual([200]);
  });
});
