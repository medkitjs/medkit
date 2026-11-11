// Covers the npm metadata of the four published packages: every field npm and
// provenance need is present and points at the right package, and each pack
// output carries the package's own LICENSE, identical to the repository's.
//
// Not covered: "private", which stays true until the M4 release commit removes
// it, and whether the package contents work once installed, which the example
// apps cover at M4.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES = ['elements', 'core', 'cli', 'vite'];

const readJson = async (path: string) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));

test.each(PACKAGES)('@medkitjs/%s has every field npm and provenance need, pointing at its own folder', async (name) => {
  const pkg = await readJson(`packages/${name}/package.json`);

  expect(pkg.description, 'a description').toEqual(expect.any(String));
  expect(pkg.description.length, 'a description').toBeGreaterThan(20);
  expect(pkg.keywords?.length, 'keywords').toBeGreaterThan(0);
  expect(pkg.license).toBe('MIT');
  expect(pkg.author, 'an author, with no email').toMatch(/^[^@<>]+$/);
  expect(pkg.repository).toEqual({ type: 'git', url: 'git+https://github.com/medkitjs/medkit.git', directory: `packages/${name}` });
  expect(pkg.bugs).toEqual({ url: 'https://github.com/medkitjs/medkit/issues' });
  expect(pkg.homepage).toBe(`https://github.com/medkitjs/medkit/tree/main/packages/${name}#readme`);
  expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
});

test.each(PACKAGES)('the @medkitjs/%s tarball carries its own LICENSE, the same as the repository one', async (name) => {
  const dir = resolve(ROOT, 'packages', name);
  expect(await readFile(resolve(dir, 'LICENSE'), 'utf8'), 'packages/' + name + '/LICENSE').toBe(await readFile(resolve(ROOT, 'LICENSE'), 'utf8'));

  const { stdout } = await promisify(execFile)('pnpm', ['pack', '--dry-run', '--json'], { cwd: dir });
  const files = (JSON.parse(stdout) as { files: { path: string }[] }).files.map((f) => f.path);
  expect(files, 'pack output').toContain('LICENSE');
});
