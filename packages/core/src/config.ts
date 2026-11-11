import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface MedkitConfig {
  /** Where processed files are written, resolved against the config's folder. Default `public/media`. */
  outDir: string;
  /** Where those files are served from, a path or a CDN URL, always ending in `/`. Default `/media/`. */
  baseUrl: string;
}

export const CONFIG_FILE = 'medkit.config.js';

/**
 * Reads `medkit.config.js` from `dir`. A missing file means the defaults; a
 * file that exists but fails to load, or sets an unknown key or a wrong type,
 * throws, because a typo silently falling back to defaults would write media
 * to the wrong place.
 */
export async function loadConfig(dir: string = process.cwd()): Promise<MedkitConfig> {
  const path = resolve(dir, CONFIG_FILE);
  try {
    await access(path);
  } catch {
    return { outDir: resolve(dir, 'public/media'), baseUrl: '/media/' };
  }
  const loaded = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (typeof loaded.default !== 'object' || loaded.default === null) {
    throw new Error(`${path}: export default an object, such as { outDir, baseUrl }`);
  }
  const user = loaded.default as Record<string, unknown>;

  for (const [key, value] of Object.entries(user)) {
    if (key !== 'outDir' && key !== 'baseUrl') throw new Error(`${path}: unknown option "${key}"`);
    if (typeof value !== 'string' || value === '') throw new Error(`${path}: "${key}" must be a non-empty string`);
  }
  const baseUrl = (user.baseUrl as string | undefined) ?? '/media/';
  return {
    outDir: resolve(dir, (user.outDir as string | undefined) ?? 'public/media'),
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  };
}
