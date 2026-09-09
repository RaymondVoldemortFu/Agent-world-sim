import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'frontend/tests/e2e',
  globalSetup: 'frontend/tests/e2e/setup.ts',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 1120 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
  reporter: 'list',
  workers: 1,
});
