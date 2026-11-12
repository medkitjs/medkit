import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/setup.ts',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  // The gate records the screen, which is timing-sensitive: it runs one test
  // at a time, after the rest of its engine's tests. CI runs <engine>-gate,
  // which pulls in <engine> as its dependency.
  projects: (['chromium', 'firefox', 'webkit'] as const).flatMap((name) => {
    const use = devices[{ chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[name]];
    return [
      { name, use, testIgnore: 'video-gate.spec.ts' },
      { name: `${name}-gate`, use, testMatch: 'video-gate.spec.ts', workers: 1, dependencies: [name] },
    ];
  }),
  webServer: {
    // Serves the repository root, so fixtures load the built elements from
    // packages/elements/dist; run `pnpm build` first.
    command: 'vite --port 4173 --strictPort',
    url: 'http://localhost:4173/examples/html/',
    reuseExistingServer: true,
  },
});
