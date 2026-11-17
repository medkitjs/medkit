// Covers what a bundler sees when it builds a site with @medkitjs/elements:
// every entry except the opt-in `hls` one builds with hls.js missing, so an
// app that never installed it is not broken by the player. A real Vite build
// of the built dist/, with hls.js made unresolvable, as it is in an app that
// does not depend on it. Needs `pnpm build`.
//
// Not covered: webpack and other bundlers, which resolve imports the same way
// for this purpose (a static or dynamic import of a missing package fails);
// and running the bundles, which the Playwright specs do.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { expect, test } from 'vitest';

const DIST = resolve(import.meta.dirname, '../packages/elements/dist');

/** Makes hls.js unresolvable, as in an app that does not depend on it. */
const withoutHls: Plugin = {
  name: 'without-hls',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'hls.js' || id.startsWith('hls.js/')) throw new Error(`Could not resolve "${id}"`);
  },
};

const bundle = async (entry: string) => {
  const outDir = await mkdtemp(join(tmpdir(), 'medkit-build-'));
  try {
    await build({ configFile: false, logLevel: 'silent', plugins: [withoutHls], build: { outDir, lib: { entry: join(DIST, entry), formats: ['es'] } } });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
};

test.each(['index.js', 'image.js', 'video-bg.js', 'player.js'])('a build importing %s succeeds without hls.js installed', async (entry) => {
  await expect(bundle(entry)).resolves.toBeUndefined();
});

test('the opt-in hls entry is the one that needs hls.js, so the check above can fail', async () => {
  await expect(bundle('hls.js')).rejects.toThrow(/hls\.js/);
});
