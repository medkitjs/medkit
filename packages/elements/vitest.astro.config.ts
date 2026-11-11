// The Astro component test runs through Astro's own Vite config, because only
// Astro's compiler can turn Image.astro into something a test can render.
import { getViteConfig } from 'astro/config';

export default getViteConfig(
  { test: { name: 'astro', root: import.meta.dirname, include: ['test/astro.test.ts'] } },
  { root: import.meta.dirname, logLevel: 'error' },
);
