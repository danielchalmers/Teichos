import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
});
