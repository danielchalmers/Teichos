import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  // Retry on CI only. The e2e suite drives a real MV3 service worker whose
  // event-driven wake/reconcile timing is inherently non-deterministic under
  // load; retries are a backstop for that residual jitter, not a substitute for
  // the determinism fixes. Kept at 0 locally so flakiness stays visible.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  timeout: 30_000,
  // Most e2e assertions wait for the background service worker to wake, react to
  // a storage change, and reconcile open tabs. Playwright's default 5s expect
  // timeout is too tight for that path under CI/heavy load; widen it while
  // keeping the 30s per-test ceiling so a genuinely stuck run still fails fast.
  expect: {
    timeout: 15_000,
  },
  use: {
    headless: true,
    // NOTE: the e2e fixtures launch their own persistent context (required to
    // load the unpacked extension), so Playwright's built-in artifact wiring
    // (trace/video/navigationTimeout from `use`) does not apply here. Tracing
    // and navigation timeouts are configured directly on the context in
    // test/e2e/fixtures.ts instead.
  },
});
