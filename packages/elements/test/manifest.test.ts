// Covers the generated manifest schema: that the shapes the TypeScript types
// describe pass, and that each constraint the schema promises rejects what it
// should. Validates against dist/, the file that ships, so run `pnpm build`
// first.
//
// Not covered: whether processing in @medkitjs/core writes valid manifests
// (that belongs to core's tests, once core exists), and runtime validation in
// the elements, which deliberately never happens.

import { Ajv } from 'ajv';
import { describe, expect, test } from 'vitest';
import schema from '../dist/manifest.schema.json' with { type: 'json' };
import type { ImageManifest, VideoManifest } from '../src/manifest.js';

const validate = new Ajv({ allErrors: true }).compile(schema);

const placeholder = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASo=';

const image = {
  v: 1,
  id: 'hero',
  kind: 'image',
  width: 1600,
  height: 900,
  placeholder,
  color: '#1d2433',
  avif: [{ src: 'hero-640.avif', width: 640, height: 360, bytes: 41233 }],
  webp: [{ src: 'hero-640.webp', width: 640, height: 360, bytes: 52190 }],
  jpeg: [{ src: 'hero-640.jpg', width: 640, height: 360, bytes: 68411 }],
  hash: '4e1a07',
} satisfies ImageManifest;

const video = {
  v: 1,
  id: 'festival',
  kind: 'video',
  width: 1920,
  height: 1080,
  duration: 14.2,
  audio: false,
  poster: { id: 'festival-poster', placeholder, color: '#1d2433' },
  mp4: [
    { src: 'festival-480.mp4', width: 854, height: 480, codec: 'avc1.640028', bytes: 1820311 },
    { src: 'festival-480-av1.mp4', width: 854, height: 480, codec: 'av01.0.04M.08', bytes: 1200000 },
  ],
  hls: 'festival/master.m3u8',
  hash: 'b3f9c2',
} satisfies VideoManifest;

function accepts(manifest: unknown): boolean {
  return validate(manifest) as boolean;
}

describe('manifest schema', () => {
  test('an image manifest with every field passes', () => {
    expect(accepts(image), JSON.stringify(validate.errors)).toBe(true);
  });

  test('a video manifest with H.264 and AV1 renditions and HLS passes', () => {
    expect(accepts(video), JSON.stringify(validate.errors)).toBe(true);
  });

  test('a video processed without HLS passes, because hls is optional', () => {
    const { hls: _, ...withoutHls } = video;
    expect(accepts(withoutHls), JSON.stringify(validate.errors)).toBe(true);
  });

  test('a manifest without the format version is rejected', () => {
    const { v: _, ...unversioned } = image;
    expect(accepts(unversioned), 'a manifest with no v').toBe(false);
  });

  test('a format version this schema does not know is rejected', () => {
    expect(accepts({ ...image, v: 2 }), 'a manifest claiming v 2').toBe(false);
  });

  test('a kind other than image or video is rejected', () => {
    expect(accepts({ ...image, kind: 'audio' }), 'kind audio').toBe(false);
  });

  test('every required field is required', () => {
    for (const manifest of [image, video] as Record<string, unknown>[]) {
      for (const key of Object.keys(manifest).filter((k) => k !== 'hls')) {
        const { [key]: _, ...rest } = manifest;
        expect(accepts(rest), `a ${manifest.kind} manifest missing ${key}`).toBe(false);
      }
    }
  });

  test('a field the format does not define is rejected, so typos surface', () => {
    expect(accepts({ ...image, widht: 1600 }), 'a top-level typo').toBe(false);
    const rendition = { ...image.avif[0], byte: 1 };
    expect(accepts({ ...image, avif: [rendition] }), 'a typo inside a rendition').toBe(false);
  });

  test('sizes are positive whole numbers', () => {
    expect(accepts({ ...image, width: 0 }), 'width 0').toBe(false);
    expect(accepts({ ...image, height: 900.5 }), 'a fractional height').toBe(false);
    expect(accepts({ ...video, duration: 0 }), 'a zero duration').toBe(false);
  });

  test('an image with an empty format list is rejected', () => {
    expect(accepts({ ...image, avif: [] }), 'no avif renditions').toBe(false);
    expect(accepts({ ...video, mp4: [] }), 'no mp4 renditions').toBe(false);
  });

  test('the inline placeholder stays within 600 characters', () => {
    const atLimit = placeholder.slice(0, -1).padEnd(600, 'A');
    expect(atLimit.length).toBe(600);
    expect(accepts({ ...image, placeholder: atLimit }), 'a 600-character placeholder').toBe(true);
    expect(accepts({ ...image, placeholder: atLimit + 'A' }), 'a 601-character placeholder').toBe(false);
  });

  test('the placeholder must be a WebP data URI, not any URL', () => {
    expect(accepts({ ...image, placeholder: 'https://example.com/blur.webp' }), 'a remote URL').toBe(false);
    expect(accepts({ ...image, placeholder: 'data:image/svg+xml;base64,PHN2Zz4=' }), 'an SVG data URI').toBe(false);
    expect(accepts({ ...image, placeholder: 'data:image/webp;base64,"><script>' }), 'markup after the prefix').toBe(false);
  });

  test('colours are lowercase six-digit hex', () => {
    expect(accepts({ ...image, color: '#1D2433' }), 'uppercase hex').toBe(false);
    expect(accepts({ ...image, color: 'red' }), 'a colour name').toBe(false);
    expect(accepts({ ...image, color: '#123' }), 'three-digit hex').toBe(false);
  });

  test('the hash is lowercase hex', () => {
    expect(accepts({ ...image, hash: 'B3F9C2' }), 'uppercase hash').toBe(false);
    expect(accepts({ ...image, hash: '' }), 'an empty hash').toBe(false);
  });

  test('a codec other than H.264 or AV1 is rejected', () => {
    const vp9 = { ...video.mp4[0], codec: 'vp09.00.10.08' };
    expect(accepts({ ...video, mp4: [vp9] }), 'a VP9 rendition').toBe(false);
  });

  test('a file path with a scheme, a leading slash or a parent segment cannot leave the media folder', () => {
    const escapes = [
      '/etc/passwd',
      '\\\\server\\share.mp4',
      'https://evil.example/x.jpg',
      'javascript:alert(1)',
      '../secret.jpg',
      'festival/../../secret.jpg',
      'festival/..',
      '..',
      'dir\\..\\x.jpg',
    ];
    for (const src of escapes) {
      const rendition = { ...image.avif[0], src };
      expect(accepts({ ...image, avif: [rendition] }), `src ${src}`).toBe(false);
      expect(accepts({ ...video, hls: src }), `hls ${src}`).toBe(false);
    }
  });

  test('ordinary relative paths, including dots inside names, are accepted', () => {
    for (const src of ['hero-640.avif', 'festival/master.m3u8', 'a..b.jpg', './hero.jpg', 'v1.2/clip.mp4']) {
      const rendition = { ...image.avif[0], src };
      expect(accepts({ ...image, avif: [rendition] }), `src ${src}`).toBe(true);
    }
  });

  test('an id is a safe file stem', () => {
    expect(accepts({ ...image, id: 'hero portrait' }), 'an id with a space').toBe(false);
    expect(accepts({ ...image, id: '../hero' }), 'an id with a path').toBe(false);
    expect(accepts({ ...image, id: '-hero' }), 'an id starting with a dash').toBe(false);
  });
});
