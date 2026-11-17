#!/usr/bin/env node
import { existsSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { checkFfmpeg, loadConfig, processImage, processThumbnail, processVideo, videoOptionsFor, type Provider } from '@medkitjs/core';

const USAGE = `Usage: medkit process <dir> [--out <dir>] [--watch] [--concurrency <n>]
       medkit thumbnail <youtube:id | vimeo:id>... [--out <dir>]

  --out          where files go; overrides outDir in medkit.config.js
  --watch        keep running and process files as they change
  --concurrency  files processed at once; default the smaller of 4 and the CPU count

Video settings, defaults and per file, come from "video" in medkit.config.js.
thumbnail fetches each video's thumbnail once, for a YouTube or Vimeo facade's
poster, as the manifest <provider>-<id>; it is not fetched again while that
manifest and its files exist.`;

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif']);
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

const kind = (file: string) => (IMAGE.has(extname(file).toLowerCase()) ? 'image' : VIDEO.has(extname(file).toLowerCase()) ? 'video' : undefined);

/** Every manifest id a file writes: its own, plus its poster's for a video. */
function claims(file: string): string[] {
  const id = basename(file, extname(file));
  return kind(file) === 'video' ? [id, `${id}-poster`] : [id];
}

class UsageError extends Error {}

/** Resolves to the exit code, or to nothing while --watch keeps the process running. */
async function main(argv: string[]): Promise<number | undefined> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      watch: { type: 'boolean' },
      concurrency: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [command, dir, ...extra] = positionals;
  if (command === 'thumbnail') return thumbnails(positionals.slice(1), values.out);
  if (command !== 'process' || !dir || extra.length) throw new UsageError('expected: medkit process <dir>');

  // ponytail: each sharp job already uses every core, so 4 at once bounds memory, not CPU.
  const concurrency = values.concurrency === undefined ? Math.min(4, availableParallelism()) : Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new UsageError('--concurrency must be a whole number of at least 1');

  const config = await loadConfig();
  const outDir = values.out ? resolve(values.out) : config.outDir;
  const root = resolve(dir);
  const files = (await readdir(root, { recursive: true }))
    .filter((f) => kind(f))
    .map((f) => join(root, f))
    .sort();

  // Manifests are named by file stem in one flat folder, so two sources with
  // the same stem would overwrite each other's output without this check.
  const seen = new Map<string, string>();
  for (const file of files) {
    for (const id of claims(file)) {
      const other = seen.get(id);
      if (other) throw new Error(`${other} and ${file} would both write "${id}"; rename one`);
      seen.set(id, file);
    }
  }

  // Per-file video options name files by path; one that matches nothing is a
  // typo that would otherwise silently encode with the defaults.
  const videos = new Set(files.filter((f) => kind(f) === 'video').map((f) => posix(root, f)));
  for (const key of Object.keys(config.video.files)) {
    if (!videos.has(key)) throw new Error(`video.files in medkit.config.js names "${key}", which is not a video in ${root}`);
  }
  if (videos.size) {
    const av1 = config.video.av1 || Object.values(config.video.files).some((f) => f.av1);
    await checkFfmpeg(['libx264', ...(av1 ? ['libsvtav1'] : [])]);
  }

  const handle = (file: string) =>
    kind(file) === 'video'
      ? processVideo(file, { outDir, ...videoOptionsFor(config, posix(root, file)) })
      : processImage(file, { outDir });
  const failed = await runAll(files, concurrency, handle);
  console.log(`medkit: ${files.length - failed} of ${files.length} files processed into ${outDir}`);

  if (values.watch) {
    watchFiles(root, seen, handle);
    return undefined;
  }
  return failed ? 1 : 0;
}

async function thumbnails(specs: string[], out: string | undefined): Promise<number> {
  if (!specs.length) throw new UsageError('expected: medkit thumbnail youtube:<id> or vimeo:<id>');
  const parsed = specs.map((spec) => {
    const [, provider, id] = /^(youtube|vimeo):(.+)$/.exec(spec) ?? [];
    if (!provider) throw new UsageError(`"${spec}" is not youtube:<id> or vimeo:<id>`);
    return { spec, provider: provider as Provider, id };
  });
  const outDir = out ? resolve(out) : (await loadConfig()).outDir;
  let failed = 0;
  for (const { spec, provider, id } of parsed) {
    try {
      const manifest = await processThumbnail(provider, id, { outDir });
      console.log(`medkit: ${spec} as ${manifest.id}`);
    } catch (error) {
      failed++;
      console.error(`medkit: ${spec}: ${(error as Error).message}`);
    }
  }
  return failed ? 1 : 0;
}

/** A path relative to the source folder, with `/` on every platform, as video.files keys are written. */
const posix = (root: string, file: string) => relative(root, file).split(sep).join('/');

/** Runs every job, at most `limit` at a time; one failure never stops the rest. Returns the number that failed. */
async function runAll(files: string[], limit: number, job: (file: string) => Promise<unknown>): Promise<number> {
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        await job(file);
      } catch (error) {
        failed++;
        console.error(`medkit: ${file}: ${(error as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
  return failed;
}

/** `seen` maps each id to the one file that owns it, as checked before the first run. */
function watchFiles(root: string, seen: Map<string, string>, handle: (file: string) => Promise<unknown>) {
  const pending = new Map<string, NodeJS.Timeout>();
  console.log(`medkit: watching ${root}`);
  watch(root, { recursive: true }, (_, name) => {
    if (!name || !kind(name)) return;
    const file = join(root, name);
    // Editors and copies fire several events per save; wait for them to settle.
    clearTimeout(pending.get(file));
    pending.set(
      file,
      setTimeout(() => {
        pending.delete(file);
        const ids = claims(file);
        if (!existsSync(file)) {
          for (const id of ids) if (seen.get(id) === file) seen.delete(id);
          return;
        }
        // An owner may have been renamed or deleted without an event yet.
        const clash = ids.find((id) => seen.get(id) && seen.get(id) !== file && existsSync(seen.get(id)!));
        if (clash) {
          console.error(`medkit: ${seen.get(clash)} and ${file} would both write "${clash}"; rename one. Skipped ${file}`);
          return;
        }
        for (const id of ids) seen.set(id, file);
        handle(file).then(
          () => console.log(`medkit: processed ${file}`),
          (error: Error) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`medkit: ${file}: ${error.message}`);
          },
        );
      }, 100),
    );
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (error: NodeJS.ErrnoException) => {
    const usage = error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS');
    console.error(`medkit: ${error.message}`);
    if (usage) console.error(USAGE);
    process.exit(usage ? 2 : 1);
  },
);
