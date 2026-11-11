// Covers processImage with real sharp runs on images generated here: which
// widths and formats are written, metadata stripping, the blur placeholder and
// its fallbacks, dominant colour, JPEG flattening and the hash cache. Every
// manifest is checked against the generated schema in elements' dist/, so run
// `pnpm build` first.
//
// Not covered: visual quality of the encodes, which no assertion here could
// judge, and the CLI's handling of many files, which the CLI tests cover.

import { Ajv } from 'ajv';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import schema from '../../elements/dist/manifest.schema.json' with { type: 'json' };
import { exactRatio } from '../src/image.js';
import { processImage } from '../src/index.js';

const validate = new Ajv({ allErrors: true }).compile(schema);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-image-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function solid(width: number, height: number, background: { r: number; g: number; b: number; alpha: number }) {
  return sharp({ create: { width, height, channels: 4, background } });
}

async function noise(width: number, height: number, path: string) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
  await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(path);
}

describe('processImage', () => {
  test('writes AVIF, WebP and JPEG at every width and a manifest that passes the schema', async () => {
    const input = join(dir, 'hero.jpg');
    await solid(1600, 900, { r: 29, g: 36, b: 51, alpha: 1 }).jpeg().toFile(input);

    const manifest = await processImage(input, { outDir: join(dir, 'out') });

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({ id: 'hero', width: 1600, height: 900 });
    for (const [format, ext] of [['avif', 'avif'], ['webp', 'webp'], ['jpeg', 'jpg']] as const) {
      expect(manifest[format].map((r) => r.width), `${format} widths`).toEqual([320, 640, 960, 1280, 1600]);
      for (const r of manifest[format]) {
        const file = join(dir, 'out', r.src);
        const meta = await sharp(file).metadata();
        expect(r.src, `${format} file name`).toBe(`hero-${r.width}.${ext}`);
        expect([meta.width, meta.height], `${r.src} dimensions`).toEqual([r.width, r.height]);
        expect((await stat(file)).size, `${r.src} byte count`).toBe(r.bytes);
      }
    }
  });

  test('every rendition has exactly the source aspect ratio, so its box never changes when the file loads', async () => {
    const input = join(dir, 'photo.jpg');
    await solid(1200, 800, { r: 50, g: 60, b: 70, alpha: 1 }).jpeg().toFile(input);

    const manifest = await processImage(input, { outDir: dir });

    expect(manifest.jpeg.map((r) => r.width), '3:2 widths snap to multiples of 3').toEqual([321, 639, 960, 1200]);
    for (const r of [...manifest.avif, ...manifest.webp, ...manifest.jpeg]) {
      expect(r.width * manifest.height, `${r.src} is ${r.width}×${r.height}`).toBe(r.height * manifest.width);
    }
  });

  test('a source whose ratio has no small step is cropped by the fewest pixels to one that does', async () => {
    expect(exactRatio(1601, 900)).toEqual({ width: 1600, height: 900, stepX: 16, stepY: 9 });
    expect(exactRatio(1200, 800), 'a simple ratio is left alone').toEqual({ width: 1200, height: 800, stepX: 3, stepY: 2 });

    const input = join(dir, 'odd.png');
    await solid(1601, 900, { r: 0, g: 0, b: 0, alpha: 1 }).png().toFile(input);
    const manifest = await processImage(input, { outDir: dir });
    expect([manifest.width, manifest.height]).toEqual([1600, 900]);
  });

  test('EXIF orientation is applied, then every metadata block, GPS location included, is gone', async () => {
    const input = join(dir, 'phone.jpg');
    await solid(300, 200, { r: 200, g: 100, b: 50, alpha: 1 })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Copyright: 'someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '44/1 49/1 0/1' } })
      .toFile(input);
    expect((await sharp(input).metadata()).exif, 'the fixture itself carries EXIF').toBeDefined();

    const manifest = await processImage(input, { outDir: dir });

    expect([manifest.width, manifest.height], 'orientation 6 turns 300×200 portrait').toEqual([200, 300]);
    for (const r of [...manifest.avif, ...manifest.webp, ...manifest.jpeg]) {
      const meta = await sharp(join(dir, r.src)).metadata();
      expect(meta.exif, `${r.src} still has EXIF`).toBeUndefined();
      expect(meta.xmp, `${r.src} still has XMP`).toBeUndefined();
      expect(meta.orientation ?? 1, `${r.src} still has an orientation tag`).toBe(1);
    }
  });

  test('the dominant colour is the colour that covers the image', async () => {
    const input = join(dir, 'red.png');
    await solid(400, 300, { r: 220, g: 30, b: 40, alpha: 1 }).png().toFile(input);

    const { color } = await processImage(input, { outDir: dir });

    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    expect(Math.abs(r - 220) + Math.abs(g - 30) + Math.abs(b - 40), `dominant ${color}`).toBeLessThan(48);
  });

  test('the blur placeholder is a WebP data URI of at most 600 characters', async () => {
    const input = join(dir, 'photo.png');
    await noise(800, 600, input);

    const { placeholder } = await processImage(input, { outDir: dir });

    expect(placeholder).toMatch(/^data:image\/webp;base64,/);
    expect(placeholder!.length).toBeLessThanOrEqual(600);
  });

  test('when no blur fits in 600 characters, the manifest keeps only the colour and the warning names the file', async () => {
    // Noise only 12px wide is never scaled down, so every placeholder width
    // keeps all 144,000 noisy pixels, far past 600 characters at any quality.
    const input = join(dir, 'strip.png');
    await noise(12, 12000, input);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manifest = await processImage(input, { outDir: dir });

    expect(manifest.placeholder, 'a placeholder over the limit was kept').toBeUndefined();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0], 'the warning does not name the file').toContain(input);
  });

  test('transparency survives in AVIF and WebP, and the JPEG is flattened onto the background option', async () => {
    const input = join(dir, 'logo.png');
    await solid(400, 400, { r: 0, g: 0, b: 0, alpha: 0 }).png().toFile(input);

    const manifest = await processImage(input, { outDir: dir, background: '#00ff00' });

    for (const r of [manifest.avif[0], manifest.webp[0]]) {
      expect((await sharp(join(dir, r.src)).metadata()).hasAlpha, `${r.src} lost its alpha`).toBe(true);
    }
    const { data } = await sharp(join(dir, manifest.jpeg[0].src)).raw().toBuffer({ resolveWithObject: true });
    expect([data[0] < 32, data[1] > 223, data[2] < 32], `JPEG pixel ${[...data.subarray(0, 3)]}`).toEqual([true, true, true]);
  });

  test('a second run with the same file and options reuses the outputs instead of encoding again', async () => {
    const input = join(dir, 'hero.png');
    await solid(700, 400, { r: 10, g: 20, b: 30, alpha: 1 }).png().toFile(input);
    const out = join(dir, 'out');

    const first = await processImage(input, { outDir: out });
    const written = (await stat(join(out, first.avif[0].src))).mtimeMs;
    const second = await processImage(input, { outDir: out });

    expect(second).toEqual(first);
    expect((await stat(join(out, first.avif[0].src))).mtimeMs, 'the AVIF was encoded again').toBe(written);
  });

  test('changed options or a missing output file invalidate the cache', async () => {
    const input = join(dir, 'hero.png');
    await solid(700, 400, { r: 10, g: 20, b: 30, alpha: 1 }).png().toFile(input);

    const first = await processImage(input, { outDir: dir });
    const recoloured = await processImage(input, { outDir: dir, background: '#000000' });
    expect(recoloured.hash, 'a new background kept the old hash').not.toBe(first.hash);

    await unlink(join(dir, recoloured.webp[0].src));
    await processImage(input, { outDir: dir, background: '#000000' });
    await expect(stat(join(dir, recoloured.webp[0].src)), 'the deleted WebP was not rewritten').resolves.toBeDefined();
  });

  test('a file name that is not a safe id is refused before anything is written', async () => {
    const input = join(dir, 'hero portrait.png');
    await solid(100, 100, { r: 0, g: 0, b: 0, alpha: 1 }).png().toFile(input);

    await expect(processImage(input, { outDir: join(dir, 'out') })).rejects.toThrow(/not a usable id/);
    await expect(stat(join(dir, 'out')), 'the output folder was created').rejects.toThrow();
  });
});
