import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ImageManifest } from '@medkitjs/elements';
import { allExist, processImage, readManifest } from './image.js';

export type Provider = 'youtube' | 'vimeo';

export interface ThumbnailOptions {
  /** Where files and the manifest are written. Default `public/media`. */
  outDir?: string;
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch;
}

const IDS: Record<Provider, RegExp> = { youtube: /^[A-Za-z0-9_-]{11}$/, vimeo: /^\d+$/ };
// ponytail: one fixed timeout per request; retry when CI runs into a slow provider.
const TIMEOUT = 15_000;

/**
 * Fetches a YouTube or Vimeo video's thumbnail at build time and runs it
 * through processImage() as `<provider>-<id>`, for a facade's poster, so a
 * visitor's browser makes no request to the provider before they press play.
 * Once its manifest and files exist, nothing is fetched again.
 */
export async function processThumbnail(provider: Provider, id: string, options: ThumbnailOptions = {}): Promise<ImageManifest> {
  if (!IDS[provider]) throw new Error(`"${provider}" is not a provider; use youtube or vimeo`);
  if (!IDS[provider].test(id)) throw new Error(`"${id}" is not a ${provider} video id`);
  const outDir = options.outDir ?? 'public/media';
  const manifestId = `${provider}-${id}`;
  const previous = await readManifest(join(outDir, `${manifestId}.json`));
  if (previous && (await allExist(previous, outDir))) return previous;

  const get = (url: string) => (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT) });
  let bytes: Buffer;
  if (provider === 'youtube') {
    // Not every video has a maxres thumbnail; hqdefault always exists, as a
    // 4:3 frame with the 16:9 picture letterboxed inside.
    const maxres = await get(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
    if (maxres.ok) bytes = Buffer.from(await maxres.arrayBuffer());
    else {
      const hq = await get(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
      if (!hq.ok) throw new Error(`youtube ${id}: no thumbnail (HTTP ${hq.status})`);
      const image = sharp(Buffer.from(await hq.arrayBuffer()));
      const { width = 480, height = 360 } = await image.metadata();
      const band = Math.round((width * 9) / 16);
      bytes = await image.extract({ left: 0, top: Math.floor((height - band) / 2), width, height: band }).toBuffer();
    }
  } else {
    const oembed = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}&width=1920`);
    if (!oembed.ok) throw new Error(`vimeo ${id}: oEmbed answered HTTP ${oembed.status}`);
    const { thumbnail_url: url } = (await oembed.json()) as { thumbnail_url?: unknown };
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`vimeo ${id}: oEmbed gave no https thumbnail_url`);
    const image = await get(url);
    if (!image.ok) throw new Error(`vimeo ${id}: thumbnail answered HTTP ${image.status}`);
    bytes = Buffer.from(await image.arrayBuffer());
  }

  const dir = await mkdtemp(join(tmpdir(), 'medkit-thumbnail-'));
  try {
    const file = join(dir, `${manifestId}.img`);
    await writeFile(file, bytes);
    return await processImage(file, { outDir, id: manifestId });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
