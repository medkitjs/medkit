import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'tests/*.test.ts'],
          exclude: ['packages/elements/test/astro.test.ts'],
          // Core and CLI tests run real sharp encodes; AVIF from noise takes
          // seconds on a CI runner, past the 5s default.
          testTimeout: 30_000,
        },
      },
      'packages/elements/vitest.astro.config.ts',
    ],
  },
});
