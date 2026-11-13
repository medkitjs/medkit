import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';

/** Runs ffmpeg with an argument array, never through a shell. */
export async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 });
}

/** Runs ffprobe and parses its JSON output. */
export async function ffprobe(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', ...args], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const checked = new Map<string, Promise<void>>();

/**
 * Stops with a clear message unless ffmpeg 6 or newer, ffprobe, and every
 * encoder named are on PATH. Checked once per process and encoder set.
 */
export function checkFfmpeg(encoders: string[], bin = FFMPEG): Promise<void> {
  const key = `${bin} ${encoders.join(' ')}`;
  let check = checked.get(key);
  if (!check) {
    check = runCheck(encoders, bin);
    checked.set(key, check);
  }
  return check;
}

async function runCheck(encoders: string[], bin: string): Promise<void> {
  const install = 'Install it with your package manager (on Ubuntu: sudo apt-get install ffmpeg) and make sure it is on PATH.';
  let version: string;
  let list: string;
  try {
    version = (await run(bin, ['-hide_banner', '-version'])).stdout;
    list = (await run(bin, ['-hide_banner', '-encoders'])).stdout;
    await run(FFPROBE, ['-version']);
  } catch {
    throw new Error(`medkit: video needs ffmpeg and ffprobe, and "${bin}" could not be run. ${install}`);
  }
  // Release builds print "ffmpeg version 6.1.1"; git builds print "N-…" and are assumed current.
  const major = /^ffmpeg version n?(\d+)\./m.exec(version)?.[1];
  if (major && Number(major) < 6) throw new Error(`medkit: video needs ffmpeg 6 or newer; found ${major}. ${install}`);
  const missing = encoders.filter((e) => !new RegExp(`^\\s*V\\S*\\s+${e}\\s`, 'm').test(list));
  if (missing.length) {
    throw new Error(`medkit: this ffmpeg was built without ${missing.join(' and ')}. Use a build that includes it, such as Ubuntu's or Homebrew's.`);
  }
}
