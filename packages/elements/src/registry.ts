import type { Loader } from './cdn.js';

/** What configure() and registerLocale() set; shared by the loaders module and the elements. */
// No prototypes, so loader="constructor" or lang="__proto__" finds nothing instead of Object's own members.
export const registry: {
  loader?: Loader;
  loaders: Record<string, Loader>;
  labels: Record<string, string>;
  locales: Record<string, Record<string, string>>;
  /** Loads hls.js: its module, or its default export. */
  hls?: () => Promise<unknown>;
} = { loaders: Object.create(null), labels: Object.create(null), locales: Object.create(null) };

/** Elements waiting for a loader; configure() runs each once. */
export const pending = new Set<() => void>();
