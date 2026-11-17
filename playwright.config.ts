import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

/**
 * End-to-end tests run against a dev server started with the test hooks on.
 * Chromium is given a fake camera device: getUserMedia works without
 * hardware, and the stream contains no face.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    permissions: ['camera'],
    locale: 'fr-FR',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_ENABLE_TEST_HOOKS: 'true' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
