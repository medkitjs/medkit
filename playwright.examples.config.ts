import { defineConfig, devices } from '@playwright/test';

// The example apps, each served by its own production server: build them first
// (`pnpm build && pnpm build:examples`). Kept apart from playwright.config.ts
// so the element tests never wait on three app servers.
const EXAMPLES = {
  // A static site, served as any static host would. `astro preview` detaches
  // itself into the background when it has no terminal, which Playwright
  // reads as the server exiting.
  astro: { port: 4321, command: 'vite preview examples/astro --port 4321 --strictPort' },
  next: { port: 3100, command: 'pnpm --filter @medkitjs/example-next start -p 3100' },
  php: { port: 8100, command: 'php -S 127.0.0.1:8100 -t examples/php/public' },
};

export default defineConfig({
  testDir: 'tests/examples',
  reporter: 'list',
  use: { trace: process.env.CI ? 'retain-on-failure' : 'off' },
  projects: (['chromium', 'firefox', 'webkit'] as const).flatMap((engine) =>
    Object.entries(EXAMPLES).map(([name, { port }]) => ({
      name: `${engine}-${name}`,
      use: { ...devices[{ chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[engine]], baseURL: `http://127.0.0.1:${port}` },
    })),
  ),
  webServer: Object.values(EXAMPLES).map(({ port, command }) => ({ command, url: `http://127.0.0.1:${port}/`, reuseExistingServer: !process.env.CI })),
});
