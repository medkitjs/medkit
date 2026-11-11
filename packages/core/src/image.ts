import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { DEFAULT_WIDTHS, pickWidths, type ImageManifest, type Rendition } from '@medkitjs/elements';

export interface ImageOptions {
  /** Where files and the manifest are written. Default `public/media`. */
  outDir?: string;
  /** Manifest id and file stem. Default: the input's file name without its extension. */
  id?: string;
  /** Widths to generate; never larger than the original. */
  widths?: number[];
  /** What transparency is flattened onto in the JPEG fallback. Default `#ffffff`. */
  background?: string;
}

// Bump whenever the same input and options would produce different files, so
// every cached manifest is invalidated.
const PIPELINE_VERSION = 2;

const PLACEHOLDER_MAX = 600;
const PLACEHOLDER_WIDTHS = [20, 16, 12];
const PLACEHOLDER_QUALITIES = [50, 30, 10];

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function processImage(input: string, options: ImageOptions = {}): Promise<ImageManifest> {
  const outDir = options.outDir ?? 'public/media';
  const id = options.id ?? basename(input, extname(input));
  if (!ID.test(id)) {
    throw new Error(`${input}: "${id}" is not a usable id; rename the file or pass { id }`);
  }
  const widths = options.widths ?? DEFAULT_WIDTHS;
  const background = options.background ?? '#ffffff';

  const bytes = await readFile(input);
  const hash = createHash('sha256')
    .update(JSON.stringify({ PIPELINE_VERSION, id, widths, background }))
    .update(bytes)
    .digest('hex');

  const manifestPath = join(outDir, `${id}.json`);
  const previous = await readManifest(manifestPath);
  if (previous?.hash === hash && (await allExist(previous, outDir))) return previous;

  // Decoding once to raw sRGB pixels applies EXIF orientation and leaves every
  // metadata block (EXIF, GPS, XMP, ICC) behind, because raw pixels carry none.
  let { data, info } = await sharp(bytes).rotate().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const ratio = exactRatio(info.width, info.height);
  if (ratio.width !== info.width || ratio.height !== info.height) {
    ({ data, info } = await sharp(data, { raw: info })
      .extract({
        left: Math.floor((info.width - ratio.width) / 2),
        top: Math.floor((info.height - ratio.height) / 2),
        width: ratio.width,
        height: ratio.height,
      })
      .raw()
      .toBuffer({ resolveWithObject: true }));
  }
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const pixels = () => sharp(data, { raw });

  const formats = [
    { key: 'avif', ext: 'avif', encode: (s: Sharp) => s.avif({ quality: 50, effort: 4 }) },
    { key: 'webp', ext: 'webp', encode: (s: Sharp) => s.webp({ quality: 75 }) },
    { key: 'jpeg', ext: 'jpg', encode: (s: Sharp) => s.flatten({ background }).jpeg({ quality: 80, mozjpeg: true }) },
  ] as const;

  await mkdir(outDir, { recursive: true });
  const sizes = snapWidths(pickWidths(widths, info.width), ratio);
  const renditions = await Promise.all(
    formats.map(({ ext, encode }) =>
      Promise.all(
        sizes.map(async (width): Promise<Rendition> => {
          const src = `${id}-${width}.${ext}`;
          const height = (width / ratio.stepX) * ratio.stepY;
          const out = await encode(pixels().resize({ width, height, fit: 'fill' })).toFile(join(outDir, src));
          return { src, width: out.width, height: out.height, bytes: out.size };
        }),
      ),
    ),
  );

  const { dominant } = await pixels().stats();
  const placeholder = await makePlaceholder(pixels);
  if (!placeholder) {
    console.warn(`medkit: ${input}: no blur placeholder fits in ${PLACEHOLDER_MAX} characters; using the dominant colour only`);
  }

  const manifest: ImageManifest = {
    v: 1,
    id,
    kind: 'image',
    width: info.width,
    height: info.height,
    ...(placeholder && { placeholder }),
    color: hex(dominant),
    avif: renditions[0],
    webp: renditions[1],
    jpeg: renditions[2],
    hash,
  };
  // Written last, so a manifest on disk always means every file it lists was written.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Only files the old manifest listed are ever deleted, and only plain file
  // names: a tampered manifest listing ../anything deletes nothing.
  const keep = new Set(listed(manifest));
  const orphans = listed(previous).filter((src) => !keep.has(src) && src === basename(src) && src !== '..');
  await Promise.all(orphans.map((src) => rm(join(outDir, src), { force: true })));
  return manifest;
}

/** Ratio steps above this are cropped to a simpler ratio; below it, snapped widths stay within half a step of the standard ones. */
const MAX_STEP = 64;

/**
 * The size to encode from, and its ratio in lowest terms (`stepX`:`stepY`).
 *
 * Every rendition must have exactly the declared aspect ratio. With
 * `height: auto`, browsers switch from the declared ratio to the loaded
 * file's own once it arrives, so a height rounded by even half a pixel moves
 * everything below the image. A source whose ratio has a step over 64px, such
 * as 1601×900, is cropped centrally by the fewest pixels to a ratio that does
 * not (1600×900).
 */
export function exactRatio(width: number, height: number) {
  const g = gcd(width, height);
  if (width / g <= MAX_STEP) return { width, height, stepX: width / g, stepY: height / g };
  let best = { width: 0, height: 0, stepX: 1, stepY: 1 };
  for (let p = 1; p <= MAX_STEP; p++) {
    const q = Math.max(1, Math.round((p * height) / width));
    if (gcd(p, q) !== 1) continue;
    const k = Math.min(Math.floor(width / p), Math.floor(height / q));
    if (k * p * k * q > best.width * best.height) best = { width: k * p, height: k * q, stepX: p, stepY: q };
  }
  return best;
}

/** Each width moved to the nearest multiple of the ratio's step, so its height is a whole number. */
function snapWidths(widths: number[], { width, stepX }: { width: number; stepX: number }): number[] {
  const snapped = widths.map((w) => Math.min(width, Math.max(stepX, Math.round(w / stepX) * stepX)));
  return [...new Set(snapped)];
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

async function makePlaceholder(pixels: () => Sharp): Promise<string | undefined> {
  for (const width of PLACEHOLDER_WIDTHS) {
    for (const quality of PLACEHOLDER_QUALITIES) {
      const webp = await pixels().resize({ width, withoutEnlargement: true }).blur(1).webp({ quality }).toBuffer();
      const uri = `data:image/webp;base64,${webp.toString('base64')}`;
      if (uri.length <= PLACEHOLDER_MAX) return uri;
    }
  }
  return undefined;
}

/** The manifest already on disk, or nothing if it is missing, unreadable or another format version. */
async function readManifest(path: string): Promise<ImageManifest | undefined> {
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as ImageManifest;
    return manifest?.v === 1 ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/** Every file name a manifest lists, skipping anything malformed. */
function listed(manifest: ImageManifest | undefined): string[] {
  if (!manifest) return [];
  return [manifest.avif, manifest.webp, manifest.jpeg]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .map((r) => r?.src)
    .filter((src): src is string => typeof src === 'string');
}

async function allExist(manifest: ImageManifest, outDir: string): Promise<boolean> {
  const files = listed(manifest);
  if (!files.length) return false;
  return Promise.all(files.map((src) => access(join(outDir, src)))).then(
    () => true,
    () => false,
  );
}

function hex({ r, g, b }: { r: number; g: number; b: number }): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
