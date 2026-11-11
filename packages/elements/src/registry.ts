import type { Loader } from './cdn.js';

/** What configure() set; shared by the loaders module and the element. */
export const registry: { loader?: Loader; loaders: Record<string, Loader> } = { loaders: {} };

/** Elements waiting for a loader; configure() runs each once. */
export const pending = new Set<() => void>();
