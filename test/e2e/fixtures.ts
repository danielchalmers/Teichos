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

export const test = base.extend<ExtensionFixtures>({
  context: async ({ browserName: _browserName }, use) => {
    const extensionPath = path.resolve('build/chrome-mv3-prod');
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'teichos-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    try {
      await use(context);
    } finally {
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
