import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
});
