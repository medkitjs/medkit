import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const PIPELINE_VERSION = 1;

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
  const cached = await readCached(manifestPath, outDir, hash);
  if (cached) return cached;

  // Decoding once to raw sRGB pixels applies EXIF orientation and leaves every
  // metadata block (EXIF, GPS, XMP, ICC) behind, because raw pixels carry none.
  const { data, info } = await sharp(bytes)
    .rotate()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const pixels = () => sharp(data, { raw });

  const formats = [
    { key: 'avif', ext: 'avif', encode: (s: Sharp) => s.avif({ quality: 50, effort: 4 }) },
    { key: 'webp', ext: 'webp', encode: (s: Sharp) => s.webp({ quality: 75 }) },
    { key: 'jpeg', ext: 'jpg', encode: (s: Sharp) => s.flatten({ background }).jpeg({ quality: 80, mozjpeg: true }) },
  ] as const;

  await mkdir(outDir, { recursive: true });
  const sizes = pickWidths(widths, info.width);
  const renditions = await Promise.all(
    formats.map(({ ext, encode }) =>
      Promise.all(
        sizes.map(async (width): Promise<Rendition> => {
          const src = `${id}-${width}.${ext}`;
          const out = await encode(pixels().resize({ width })).toFile(join(outDir, src));
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
  return manifest;
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

async function readCached(path: string, outDir: string, hash: string): Promise<ImageManifest | undefined> {
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as ImageManifest;
    if (manifest.v !== 1 || manifest.hash !== hash) return undefined;
    const files = [...manifest.avif, ...manifest.webp, ...manifest.jpeg].map((r) => join(outDir, r.src));
    await Promise.all(files.map((f) => access(f)));
    return manifest;
  } catch {
    return undefined;
  }
}

function hex({ r, g, b }: { r: number; g: number; b: number }): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
