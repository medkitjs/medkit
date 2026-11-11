// Covers the built `medkit` binary end to end, run as a child process: folder
// processing, medkit.config.js and --out, exit codes, --concurrency checks,
// duplicate ids and --watch. Runs dist/, so run `pnpm build` first.
//
// Not covered: what processImage writes for each file, which core's tests
// cover, and whether concurrency actually overlaps jobs, which only timing
// could show and timing tests flake.

import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, test } from 'vitest';

const BIN = resolve(import.meta.dirname, '../dist/index.js');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-cli-'));
  await mkdir(join(dir, 'src/media/nested'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const image = (path: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toFile(join(dir, path));

async function medkit(...args: string[]) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [BIN, ...args], { cwd: dir });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

const exists = (path: string) => access(join(dir, path)).then(() => true, () => false);

test('every image in the folder, nested ones too, lands in the default outDir', async () => {
  await image('src/media/hero.png');
  await image('src/media/nested/logo.png');
  await writeFile(join(dir, 'src/media/notes.txt'), 'not an image');

  const { code, stdout } = await medkit('process', 'src/media');

  expect(code, stdout).toBe(0);
  expect(await exists('public/media/hero.json'), 'hero manifest').toBe(true);
  expect(await exists('public/media/logo.json'), 'nested logo manifest').toBe(true);
  expect(stdout).toContain('2 of 2 images processed');
});

test('outDir comes from medkit.config.js, and --out overrides it', async () => {
  await image('src/media/hero.png');
  await writeFile(join(dir, 'medkit.config.js'), `export default { outDir: 'public/assets' };`);

  await medkit('process', 'src/media');
  expect(await exists('public/assets/hero.json'), 'config outDir ignored').toBe(true);

  await medkit('process', 'src/media', '--out', 'elsewhere');
  expect(await exists('elsewhere/hero.json'), '--out ignored').toBe(true);
});

test('a broken image fails the run with exit code 1 and a message naming it, but the others are still processed', async () => {
  await image('src/media/good.png');
  await writeFile(join(dir, 'src/media/broken.jpg'), 'not really a jpeg');

  const { code, stderr } = await medkit('process', 'src/media', '--concurrency', '1');

  expect(code).toBe(1);
  expect(stderr).toContain(join(dir, 'src/media/broken.jpg'));
  expect(await exists('public/media/good.json'), 'the good image was skipped').toBe(true);
});

test('two images with the same name in different folders are refused before anything is written', async () => {
  await image('src/media/hero.png');
  await image('src/media/nested/hero.jpg');

  const { code, stderr } = await medkit('process', 'src/media');

  expect(code).toBe(1);
  expect(stderr).toContain('would both write "hero"');
  expect(await exists('public/media'), 'output was written anyway').toBe(false);
});

test('a bad --concurrency, an unknown flag or a missing folder argument exit with 2 and the usage', async () => {
  for (const args of [['process', 'src/media', '--concurrency', '0'], ['process', 'src/media', '--fast'], ['process']]) {
    const { code, stderr } = await medkit(...args);
    expect(code, args.join(' ')).toBe(2);
    expect(stderr, args.join(' ')).toContain('Usage: medkit process');
  }
});

test('--watch processes an image added after it started', async () => {
  const child = spawn(process.execPath, [BIN, 'process', 'src/media', '--watch'], { cwd: dir });
  try {
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    await until(() => output.includes('watching'));

    await image('src/media/late.png');

    await until(() => exists('public/media/late.json'));
    expect(JSON.parse(await readFile(join(dir, 'public/media/late.json'), 'utf8')).id).toBe('late');
  } finally {
    child.kill();
  }
});

async function until(check: () => boolean | Promise<boolean>, timeout = 10_000) {
  for (const start = Date.now(); Date.now() - start < timeout; await new Promise((r) => setTimeout(r, 50))) {
    if (await check()) return;
  }
  throw new Error('timed out waiting');
}
