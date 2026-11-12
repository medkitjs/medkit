import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { VideoManifest, VideoRendition } from '@medkitjs/elements';
import { checkFfmpeg, ffmpeg, ffprobe } from './ffmpeg.js';
import { processImage } from './image.js';

export interface VideoOptions {
  /** Where files and the manifest are written. Default `public/media`. */
  outDir?: string;
  /** Manifest id and file stem. Default: the input's file name without its extension. */
  id?: string;
  /** Rendition sizes by their short side (480 is 854×480 for 16:9). Default 480, 720, 1080; never larger than the source. */
  ladder?: number[];
  /** Also encode AV1 with SVT-AV1. Default false: smaller files, much slower encodes. */
  av1?: boolean;
  /** Also package HLS (fMP4) from the H.264 encodes, for the player. Default false. */
  hls?: boolean;
  /** Keep the audio track as AAC 128 kbps. Default false: backgrounds are silent. */
  keepAudio?: boolean;
  /** Cut the source to this range, in seconds, before encoding. */
  trim?: { start?: number; end?: number };
  /** Seconds into the (trimmed) clip to take the poster from. Default 0. */
  posterAt?: number;
  /**
   * Peak bitrate in kbps per ladder height, capping CRF so a rung stays
   * playable on the connection it is meant for; `false` for uncapped CRF.
   * Default 480: 800, 720: 1600, 1080: 3000.
   */
  maxrate?: Record<number, number> | false;
}

export const DEFAULT_LADDER = [480, 720, 1080];
export const DEFAULT_MAXRATE: Record<number, number> = { 480: 800, 720: 1600, 1080: 3000 };

// Bump whenever the same input and options would produce different files.
const PIPELINE_VERSION = 2;

/**
 * The cap in kbps for a rung `height` pixels on its short side: its own entry,
 * else linear between the nearest heights listed, else proportional to the
 * nearest one, so a custom ladder needs no table of its own.
 */
export function maxrateFor(height: number, table: Record<number, number>): number {
  if (table[height]) return table[height];
  const heights = Object.keys(table).map(Number).sort((a, b) => a - b);
  const below = heights.filter((h) => h < height).pop();
  const above = heights.find((h) => h > height);
  if (below === undefined) return Math.round((table[above!] * height) / above!);
  if (above === undefined) return Math.round((table[below] * height) / below);
  return Math.round(table[below] + ((table[above] - table[below]) * (height - below)) / (above - below));
}

/** A `maxrate` table is non-empty, with whole-pixel heights and whole kbps above 0. */
export function isMaxrateTable(value: unknown): value is Record<number, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([h, k]) => /^[1-9]\d*$/.test(h) && Number.isInteger(k) && k > 0);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Names ffmpeg's HLS muxer writes below, and the only ones cleanup may delete.
const HLS_FILE = /^(?:master\.m3u8|\d+p(?:\.m3u8|_init\.mp4|_\d+\.m4s))$/;

const H264_PROFILE: Record<string, string> = { Baseline: '42', 'Constrained Baseline': '42', Main: '4d', High: '64' };

export async function processVideo(input: string, options: VideoOptions = {}): Promise<VideoManifest> {
  const outDir = options.outDir ?? 'public/media';
  const id = options.id ?? basename(input, extname(input));
  if (!ID.test(id)) throw new Error(`${input}: "${id}" is not a usable id; rename the file or pass { id }`);
  const ladder = options.ladder ?? DEFAULT_LADDER;
  const { av1 = false, hls = false, keepAudio = false, trim = {}, posterAt = 0, maxrate = DEFAULT_MAXRATE } = options;
  if (!ladder.length || !ladder.every((h) => Number.isInteger(h) && h > 0)) {
    throw new Error(`${input}: ladder must list whole numbers of pixels, such as [480, 720, 1080]`);
  }
  if ((trim.start ?? 0) < 0 || (trim.end !== undefined && trim.end <= (trim.start ?? 0))) {
    throw new Error(`${input}: trim needs 0 <= start < end`);
  }
  if (posterAt < 0) throw new Error(`${input}: posterAt cannot be negative`);
  if (maxrate !== false && !isMaxrateTable(maxrate)) {
    throw new Error(`${input}: maxrate must map ladder heights to whole kbps, such as { 480: 800, 720: 1600 }, or be false`);
  }

  const hash = createHash('sha256').update(JSON.stringify({ PIPELINE_VERSION, id, ladder, av1, hls, keepAudio, trim, posterAt, maxrate }));
  await pipeline(createReadStream(input), hash);
  const digest = hash.digest('hex');

  const manifestPath = join(outDir, `${id}.json`);
  const previous = await readManifest(manifestPath);
  if (previous?.hash === digest && (await allExist(previous, outDir, id))) return previous;
  // Read now: the new encode overwrites the playlists that list the old segments.
  const old = await listed(previous, outDir, id);

  await checkFfmpeg(['libx264', ...(av1 ? ['libsvtav1'] : [])]);
  const source = await probe(input);
  const start = trim.start ?? 0;
  const end = Math.min(trim.end ?? source.duration, source.duration);
  const duration = end - start;
  if (!(duration > 0)) throw new Error(`${input}: trim starts after the video ends (${source.duration}s)`);
  if (posterAt >= duration) throw new Error(`${input}: posterAt ${posterAt}s is past the end of the ${duration}s clip`);

  const short = Math.min(source.width, source.height);
  const sizes = [...new Set(ladder)].filter((h) => h <= short).sort((a, b) => a - b);
  if (!sizes.length) sizes.push(short);
  const landscape = source.width >= source.height;
  const audio = keepAudio && source.audio;

  // One decode feeds every output: the source is split once per rendition.
  const outputs = sizes.flatMap((p) => [
    { p, codec: 'h264', src: `${id}-${p}p.mp4` },
    ...(av1 ? [{ p, codec: 'av1', src: `${id}-${p}p-av1.mp4` }] : []),
  ]);
  const split = `[0:v]split=${outputs.length}${outputs.map((_, i) => `[s${i}]`).join('')}`;
  const scales = outputs.map(({ p }, i) => `[s${i}]scale=${landscape ? `-2:${p}` : `${p}:-2`}[v${i}]`);
  // A keyframe at 0 and every 2 seconds, so HLS segments and seeks line up.
  // x264 takes forced keyframes; SVT-AV1 ignores them and needs a fixed GOP.
  const gop = String(Math.round(source.fps * 2));
  const args = [...(start ? ['-ss', String(start)] : []), '-t', String(duration), '-i', input, '-filter_complex', [split, ...scales].join(';')];
  outputs.forEach(({ p, codec, src }, i) => {
    args.push('-map', `[v${i}]`, ...(audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k'] : ['-an']));
    args.push('-map_metadata', '-1', '-map_chapters', '-1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (codec === 'h264') {
      args.push('-c:v', 'libx264', '-profile:v', 'high', '-crf', '23', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0');
    } else {
      args.push('-c:v', 'libsvtav1', '-preset', '8', '-crf', '35', '-g', gop, '-svtav1-params', 'irefresh-type=2');
    }
    if (maxrate) {
      const kbps = maxrateFor(p, maxrate);
      args.push('-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`);
    }
    args.push(join(outDir, src));
  });
  await mkdir(outDir, { recursive: true });
  await ffmpeg(args);

  const mp4: VideoRendition[] = await Promise.all(
    outputs.map(async ({ src }) => {
      const file = join(outDir, src);
      const [stream] = (await ffprobe(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,level,width,height', file]))
        .streams as Stream[];
      return { src, width: stream.width, height: stream.height, codec: codecString(stream), bytes: (await stat(file)).size };
    }),
  );
  const h264 = mp4.filter((r) => r.codec.startsWith('avc1'));

  let hlsPath: string | undefined;
  if (hls) {
    const dir = join(outDir, id);
    await mkdir(dir, { recursive: true });
    const names = h264.map((r) => `${landscape ? r.height : r.width}p`);
    await ffmpeg([
      ...h264.flatMap((r) => ['-i', join(outDir, r.src)]),
      ...h264.flatMap((_, i) => ['-map', `${i}:v`, ...(audio ? ['-map', `${i}:a`] : [])]),
      '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', '%v_init.mp4', '-hls_segment_filename', join(dir, '%v_%03d.m4s'),
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', names.map((n, i) => `v:${i}${audio ? `,a:${i}` : ''},name:${n}`).join(' '),
      join(dir, '%v.m3u8'),
    ]);
    hlsPath = `${id}/master.m3u8`;
  }

  // The poster is decoded from the largest H.264 encode, not the source, so it
  // matches the first frame the browser paints when the video takes over.
  const tmp = await mkdtemp(join(tmpdir(), 'medkit-poster-'));
  let poster: VideoManifest['poster'];
  try {
    const png = join(tmp, 'poster.png');
    await ffmpeg([...(posterAt ? ['-ss', String(posterAt)] : []), '-i', join(outDir, h264.at(-1)!.src), '-frames:v', '1', png]);
    const image = await processImage(png, { outDir, id: `${id}-poster` });
    poster = { id: image.id, color: image.color };
    if (image.placeholder) poster.placeholder = image.placeholder;
    if (posterAt > 0) poster.at = posterAt;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const manifest: VideoManifest = {
    v: 1,
    id,
    kind: 'video',
    width: source.width,
    height: source.height,
    duration: Math.round(duration * 1000) / 1000,
    audio: audio ? 'mp4a.40.2' : false,
    poster,
    mp4,
    ...(hlsPath && { hls: hlsPath }),
    hash: digest,
  };
  // Written last, so a manifest on disk always means every file it lists was written.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Only files the old manifest listed, directly or through its playlists, are
  // deleted, and only names medkit itself writes.
  const keep = new Set(await listed(manifest, outDir, id));
  const orphans = old.filter((f) => !keep.has(f));
  await Promise.all(orphans.map((f) => rm(join(outDir, f), { force: true })));
  return manifest;
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  width: number;
  height: number;
  r_frame_rate?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

async function probe(input: string) {
  const info = await ffprobe(['-show_streams', '-show_format', input]).catch(() => {
    throw new Error(`${input}: ffprobe could not read this file as a video`);
  });
  const streams = info.streams as Stream[];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`${input}: no video stream`);
  const rotation = Math.abs(Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0)) % 180;
  const [num, den] = (video.r_frame_rate ?? '30/1').split('/').map(Number);
  // ffmpeg rotates while encoding, so a portrait phone video comes out portrait.
  const [width, height] = rotation === 90 ? [video.height, video.width] : [video.width, video.height];
  return {
    width,
    height,
    fps: num / (den || 1) || 30,
    duration: Number((info.format as { duration?: string }).duration),
    audio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** The RFC 6381 codec string browsers expect in `<source type>` and `canPlayType()`. */
function codecString({ codec_name, profile = '', level = 0 }: Stream): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  if (codec_name === 'h264') return `avc1.${H264_PROFILE[profile] ?? '64'}00${hex(level)}`;
  // Profile 0 (Main), the level index, Main tier, 8-bit: what SVT-AV1 writes for yuv420p.
  return `av01.0.${String(level).padStart(2, '0')}M.08`;
}

async function readManifest(path: string): Promise<VideoManifest | undefined> {
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as VideoManifest;
    return manifest?.v === 1 && manifest.kind === 'video' ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every file a manifest lists, relative to outDir: its MP4s, and its HLS
 * playlists and segments. The HLS folder comes from `id`, the checked id being
 * processed, never from the file: a tampered manifest with an id of ".." must
 * not point cleanup outside outDir.
 */
async function listed(manifest: VideoManifest | undefined, outDir: string, id: string): Promise<string[]> {
  if (!manifest) return [];
  const plain = (name: unknown): name is string => typeof name === 'string' && name === basename(name) && name !== '..';
  const files = (Array.isArray(manifest.mp4) ? manifest.mp4 : []).map((r) => r?.src).filter(plain);
  if (manifest.hls === `${id}/master.m3u8`) {
    const dir = id;
    const uris = async (playlist: string) => {
      const text = await readFile(join(outDir, dir, playlist), 'utf8').catch(() => '');
      const map = [...text.matchAll(/#EXT-X-MAP:URI="([^"]+)"/g)].map((m) => m[1]);
      return [...map, ...text.split('\n').filter((l) => l && !l.startsWith('#'))].map((l) => l.trim());
    };
    const variants = (await uris('master.m3u8')).filter((n) => HLS_FILE.test(n));
    const segments = (await Promise.all(variants.map(uris))).flat().filter((n) => HLS_FILE.test(n));
    files.push(...['master.m3u8', ...variants, ...segments].map((n) => `${dir}/${n}`));
  }
  return files;
}

async function allExist(manifest: VideoManifest, outDir: string, id: string): Promise<boolean> {
  const files = [...(await listed(manifest, outDir, id)), `${id}-poster.json`];
  return Promise.all(files.map((f) => access(join(outDir, f)))).then(
    () => true,
    () => false,
  );
}
