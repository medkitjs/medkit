import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'tests/*.test.ts'],
          exclude: ['packages/elements/test/astro.test.ts'],
        },
      },
      'packages/elements/vitest.astro.config.ts',
    ],
  },
});
