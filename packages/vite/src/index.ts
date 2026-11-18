import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { checkFfmpeg, loadConfig, processImage, processVideo, videoOptionsFor, type MedkitConfig } from '@medkitjs/core';
import type { Manifest } from '@medkitjs/elements';
import { isFileLoadingAllowed, type Plugin, type ResolvedConfig } from 'vite';

// The same extensions `medkit process` picks up.
const IMAGE = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;

/**
 * `import hero from './hero.jpg?medkit'` processes the file with
 * `@medkitjs/core` into `outDir` from `medkit.config.js` and gives the
 * manifest. `video.files` keys are relative to `srcDir`, as for the CLI.
 */
export default function medkit(): Plugin {
  let vite: ResolvedConfig;
  let config: MedkitConfig;
  let ffmpeg: Promise<unknown> | undefined;
  // Manifests are named by file stem in one flat folder, so two sources with
  // the same stem would overwrite each other's output without this check.
  const owners = new Map<string, string>();
  // Astro and other SSR setups load the same import once per environment;
  // two concurrent runs on one file would write the same outputs at once.
  const running = new Map<string, Promise<Manifest>>();
  // ponytail: each sharp job already uses every core, so 4 at once bounds memory, not CPU.
  const limit = limiter(Math.min(4, availableParallelism()));

  return {
    name: 'medkit',
    // Vite's asset plugin would otherwise load `hero.jpg?medkit` as a URL.
    enforce: 'pre',
    configResolved(resolved) {
      vite = resolved;
    },
    async buildStart() {
      config = await loadConfig(vite.root);
      // A key that matches no file is a typo that would silently encode with the defaults.
      for (const key of Object.keys(config.video.files)) {
        if (!VIDEO.test(key) || !existsSync(resolve(config.srcDir, key))) {
          this.error(`video.files in medkit.config.js names "${key}", which is not a video in ${config.srcDir}`);
        }
      }
    },
    async load(id) {
      const [file, query = ''] = id.split('?', 2);
      if (!new URLSearchParams(query).has('medkit')) return null;
      const kind = IMAGE.test(file) ? 'image' : VIDEO.test(file) ? 'video' : this.error(`${file}: ?medkit takes an image or a video`);
      // A dev server answers `/@fs/<any path>?medkit`, and Vite's server.fs
      // check does not cover what a plugin loads; without this, any image on
      // the machine could be processed into outDir and served.
      if (vite.command === 'serve' && !isFileLoadingAllowed(vite, file)) {
        this.error(`${file} is outside server.fs.allow, so ?medkit will not process it`);
      }

      const stem = basename(file, extname(file));
      for (const claim of kind === 'video' ? [stem, `${stem}-poster`] : [stem]) {
        const other = owners.get(claim);
        if (other && other !== file && existsSync(other)) this.error(`${other} and ${file} would both write "${claim}"; rename one`);
        owners.set(claim, file);
      }
      this.addWatchFile(file);

      const { mtimeMs, size } = await stat(file);
      const key = `${file}\0${mtimeMs}\0${size}`;
      let manifest = running.get(key);
      if (!manifest) {
        manifest = limit<Manifest>(() => (kind === 'image' ? processImage(file, { outDir: config.outDir }) : video(file)));
        running.set(key, manifest);
        manifest.finally(() => running.delete(key)).catch(() => {});
      }
      return `export default ${JSON.stringify(await manifest)};`;
    },
  };

  async function video(file: string) {
    // A file outside srcDir gets a "../" or absolute key, which no video.files key can be, so the defaults.
    const options = videoOptionsFor(config, relative(config.srcDir, file).split(sep).join('/'));
    ffmpeg ??= checkFfmpeg(['libx264', ...(config.video.av1 || Object.values(config.video.files).some((f) => f.av1) ? ['libsvtav1'] : [])]);
    await ffmpeg;
    return processVideo(file, { outDir: config.outDir, ...options });
  }
}

/** Runs at most `max` jobs at once; the rest wait their turn in order. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      return await job();
    } finally {
      // Hand the slot straight to the next job, so a new caller cannot slip in between.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
