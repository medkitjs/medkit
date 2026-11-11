import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LADDER, type VideoOptions } from './video.js';

/** Video settings that can differ per file; the rest are defaults for every video. */
export type VideoFileOptions = Pick<VideoOptions, 'ladder' | 'av1' | 'hls' | 'keepAudio' | 'trim' | 'posterAt'>;

export interface MedkitConfig {
  /** Where processed files are written, resolved against the config's folder. Default `public/media`. */
  outDir: string;
  /** Where those files are served from, a path or a CDN URL, always ending in `/`. Default `/media/`. */
  baseUrl: string;
  video: Required<Pick<VideoOptions, 'ladder' | 'av1' | 'hls' | 'keepAudio'>> & {
    /** Per-file options, keyed by the file's path relative to the source folder, with `/` separators. */
    files: Record<string, VideoFileOptions>;
  };
}

export const CONFIG_FILE = 'medkit.config.js';

const DEFAULTS = { ladder: DEFAULT_LADDER, av1: false, hls: false, keepAudio: false };

/**
 * Reads `medkit.config.js` from `dir`. A missing file means the defaults; a
 * file that exists but fails to load, or sets an unknown key or a wrong type,
 * throws, because a typo silently falling back to defaults would write media
 * to the wrong place. Whether each `video.files` path exists is checked by the
 * caller that knows the source folder.
 */
export async function loadConfig(dir: string = process.cwd()): Promise<MedkitConfig> {
  const path = resolve(dir, CONFIG_FILE);
  try {
    await access(path);
  } catch {
    return { outDir: resolve(dir, 'public/media'), baseUrl: '/media/', video: { ...DEFAULTS, files: {} } };
  }
  const loaded = (await import(pathToFileURL(path).href)) as { default?: unknown };
  const fail = (message: string): never => {
    throw new Error(`${path}: ${message}`);
  };
  if (typeof loaded.default !== 'object' || loaded.default === null) fail('export default an object, such as { outDir, baseUrl }');
  const user = object(loaded.default, '', ['outDir', 'baseUrl', 'video'], fail);
  for (const key of ['outDir', 'baseUrl'] as const) {
    if (user[key] !== undefined && (typeof user[key] !== 'string' || user[key] === '')) fail(`"${key}" must be a non-empty string`);
  }

  const video = object(user.video ?? {}, 'video', ['ladder', 'av1', 'hls', 'keepAudio', 'files'], fail);
  const defaults = { ...DEFAULTS, ...videoOptions(video, 'video', fail) } as MedkitConfig['video'];
  const files: Record<string, VideoFileOptions> = {};
  const listed = object(video.files ?? {}, 'video.files', null, fail);
  for (const [key, value] of Object.entries(listed)) {
    const file = key.replace(/\\/g, '/');
    if (file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
      fail(`"video.files" key "${key}" must be a path inside the source folder, such as "hero.mp4"`);
    }
    const where = `video.files["${key}"]`;
    const options = object(value, where, ['ladder', 'av1', 'hls', 'keepAudio', 'trim', 'posterAt'], fail);
    files[file] = videoOptions(options, where, fail);
  }

  const baseUrl = (user.baseUrl as string | undefined) ?? '/media/';
  return {
    outDir: resolve(dir, (user.outDir as string | undefined) ?? 'public/media'),
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    video: { ...defaults, files },
  };
}

/** The options processVideo gets for one file: the config's defaults, then that file's own. */
export function videoOptionsFor(config: MedkitConfig, file: string): VideoFileOptions {
  const { files, ...defaults } = config.video;
  return { ...defaults, ...files[file.replace(/\\/g, '/')] };
}

/** `value` as an object whose keys are all in `keys` (any key when null); `where` names it in errors, '' for the top level. */
function object(value: unknown, where: string, keys: string[] | null, fail: (m: string) => never): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`"${where}" must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (keys && !keys.includes(key)) fail(`unknown option "${key}"${where ? ` in "${where}"` : ''}`);
  }
  return record;
}

function videoOptions(record: Record<string, unknown>, where: string, fail: (m: string) => never): VideoFileOptions {
  const out: VideoFileOptions = {};
  const seconds = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`"${where}.${name}" must be a number of seconds, 0 or more`);
    return v as number;
  };
  for (const key of ['av1', 'hls', 'keepAudio'] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'boolean') fail(`"${where}.${key}" must be true or false`);
    out[key] = record[key] as boolean;
  }
  if (record.ladder !== undefined) {
    const ladder = record.ladder;
    if (!Array.isArray(ladder) || !ladder.length || !ladder.every((h) => Number.isInteger(h) && h > 0)) {
      fail(`"${where}.ladder" must list whole numbers of pixels, such as [480, 720, 1080]`);
    }
    out.ladder = ladder as number[];
  }
  if (record.posterAt !== undefined) out.posterAt = seconds(record.posterAt, 'posterAt');
  if (record.trim !== undefined) {
    const trim = object(record.trim, `${where}.trim`, ['start', 'end'], fail);
    out.trim = {};
    if (trim.start !== undefined) out.trim.start = seconds(trim.start, 'trim.start');
    if (trim.end !== undefined) out.trim.end = seconds(trim.end, 'trim.end');
    if (out.trim.end !== undefined && out.trim.end <= (out.trim.start ?? 0)) fail(`"${where}.trim" needs start < end`);
  }
  return out;
}
