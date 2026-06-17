import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  extensionPage: (relativePath: string) => string;
  page: Page;
}

// Stub every otherwise-unmocked http(s) navigation/subresource with a local 200
// so tests never depend on real DNS or network. This removes the dominant flaky
// failure (net::ERR_NAME_NOT_RESOLVED) for the non-resolving *.example.test /
// *.example.invalid domains the suite uses: a request that a per-test mock does
// not cover (favicon, subresources, sibling/redirect URLs) no longer falls
// through to real DNS with variable CI latency.
//
// Safe by construction:
// - Per-test routes (registered later in the test body) take precedence, since
//   Playwright matches the most recently registered route first.
// - Extension/internal URLs are passed through untouched so extension pages,
//   chunks, and the blocked page load normally.
// - It cannot defeat a block assertion: blocking is driven by chrome.tabs.update
//   redirecting the tab to blocked.html, independent of whether the original
//   request succeeded, so a stubbed 200 is still redirected.
async function installDeterministicNetwork(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.startsWith('chrome-extension://') ||
      url.startsWith('chrome://') ||
      url.startsWith('about:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>stub</title><main>stub</main>',
    });
  });
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ browserName: _browserName }, use) => {
    const extensionPath = path.resolve('.output', 'chrome-mv3');
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'teichos-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    // Give navigations a generous-but-bounded ceiling. The persistent context is
    // launched directly, so `use.navigationTimeout` from the config does not
    // apply and must be set here.
    context.setDefaultNavigationTimeout(15_000);

    await installDeterministicNetwork(context);

    // Capture a trace only while retrying a failed test, so residual flakiness
    // stays diagnosable without paying per-action screenshot/snapshot overhead
    // on the (common) first attempt — that overhead is itself a flakiness source
    // under load. Done manually because `use.trace` does not apply to a
    // directly-launched persistent context; this mirrors `trace: on-first-retry`.
    const captureTrace = base.info().retry > 0;
    if (captureTrace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }

    try {
      await use(context);
    } finally {
      if (captureTrace) {
        try {
          const testInfo = base.info();
          if (testInfo.status !== testInfo.expectedStatus) {
            const tracePath = testInfo.outputPath('trace.zip');
            await context.tracing.stop({ path: tracePath });
            await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' });
          } else {
            await context.tracing.stop();
          }
        } catch {
          // Tracing teardown is best-effort and must never mask a test result.
        }
      }
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    await use(new URL(serviceWorker.url()).host);
  },

  extensionPage: async ({ extensionId }, use) => {
    await use((relativePath: string) => `chrome-extension://${extensionId}/${relativePath}`);
  },

  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
