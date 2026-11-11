// Covers loadConfig: defaults without a file, resolving outDir against the
// config's folder, the trailing slash on baseUrl, and refusing a config that
// would otherwise silently fall back to defaults.
//
// Not covered: TypeScript or CommonJS config files, which are not supported;
// only `medkit.config.js` as an ES module is read.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadConfig } from '../src/index.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medkit-config-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const write = (body: string) => writeFile(join(dir, 'medkit.config.js'), body);

test('without a config file, media goes to public/media and is served from /media/', async () => {
  expect(await loadConfig(dir)).toEqual({ outDir: join(dir, 'public/media'), baseUrl: '/media/' });
});

test('outDir is resolved against the folder holding the config, and baseUrl always ends in a slash', async () => {
  await write(`export default { outDir: 'public/assets/video', baseUrl: 'https://cdn.example.com/media' };`);
  expect(await loadConfig(dir)).toEqual({
    outDir: join(dir, 'public/assets/video'),
    baseUrl: 'https://cdn.example.com/media/',
  });
});

test('a misspelt option is an error instead of a silent default', async () => {
  await write(`export default { outdir: 'public/media' };`);
  await expect(loadConfig(dir)).rejects.toThrow(/unknown option "outdir"/);
});

test('an option of the wrong type is an error', async () => {
  await write(`export default { baseUrl: 42 };`);
  await expect(loadConfig(dir)).rejects.toThrow(/"baseUrl" must be a non-empty string/);
});

test('a config without a default export is an error', async () => {
  await write(`export const outDir = 'x';`);
  await expect(loadConfig(dir)).rejects.toThrow(/export default an object/);
});
