import type { Loader } from './cdn.js';

/** What configure() set; shared by the loaders module and the element. */
// No prototype, so loader="constructor" or "__proto__" finds nothing instead of Object's own members.
export const registry: { loader?: Loader; loaders: Record<string, Loader> } = { loaders: Object.create(null) };

/** Elements waiting for a loader; configure() runs each once. */
export const pending = new Set<() => void>();
