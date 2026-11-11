#!/usr/bin/env node
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, processImage } from '@medkitjs/core';

const USAGE = `Usage: medkit process <dir> [--out <dir>] [--watch] [--concurrency <n>]

  --out          where files go; overrides outDir in medkit.config.js
  --watch        keep running and process images as they change
  --concurrency  images processed at once; default the smaller of 4 and the CPU count`;

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif']);

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
  if (command !== 'process' || !dir || extra.length) throw new UsageError('expected: medkit process <dir>');

  // ponytail: each sharp job already uses every core, so 4 at once bounds memory, not CPU.
  const concurrency = values.concurrency === undefined ? Math.min(4, availableParallelism()) : Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new UsageError('--concurrency must be a whole number of at least 1');

  const config = await loadConfig();
  const outDir = values.out ? resolve(values.out) : config.outDir;
  const root = resolve(dir);
  const files = (await readdir(root, { recursive: true }))
    .filter((f) => IMAGE.has(extname(f).toLowerCase()))
    .map((f) => join(root, f))
    .sort();

  // Manifests are named by file stem in one flat folder, so two sources with
  // the same stem would overwrite each other's output without this check.
  const seen = new Map<string, string>();
  for (const file of files) {
    const id = basename(file, extname(file));
    const other = seen.get(id);
    if (other) throw new Error(`${other} and ${file} would both write "${id}"; rename one`);
    seen.set(id, file);
  }

  const failed = await runAll(files, concurrency, (file) => processImage(file, { outDir }));
  console.log(`medkit: ${files.length - failed} of ${files.length} images processed into ${outDir}`);

  if (values.watch) {
    watchImages(root, outDir);
    return undefined;
  }
  return failed ? 1 : 0;
}

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

function watchImages(root: string, outDir: string) {
  const pending = new Map<string, NodeJS.Timeout>();
  console.log(`medkit: watching ${root}`);
  watch(root, { recursive: true }, (_, name) => {
    if (!name || !IMAGE.has(extname(name).toLowerCase())) return;
    const file = join(root, name);
    // Editors and copies fire several events per save; wait for them to settle.
    clearTimeout(pending.get(file));
    pending.set(
      file,
      setTimeout(() => {
        pending.delete(file);
        processImage(file, { outDir }).then(
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
