import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
  webServer: {
    // Serves the repository root, so fixtures load the built elements from
    // packages/elements/dist; run `pnpm build` first.
    command: 'vite --port 4173 --strictPort',
    url: 'http://localhost:4173/examples/html/',
    reuseExistingServer: true,
  },
});
