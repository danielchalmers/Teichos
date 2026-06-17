import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  expectAllowed,
  expectBlocked,
  mockAllowedPage,
  seedStorage,
} from './helpers';
import { PAGES } from '../../src/shared/constants';

test('go back restores the last allowed url', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const blockedUrl = 'https://blocked.example.invalid/focus';
  const allowedUrl = 'https://allowed.example.test/landing';

  await context.route(allowedUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Allowed</title><main>Allowed page</main>',
    });
  });

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-page-filter',
          pattern: 'blocked.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked Page',
        },
      ],
    })
  );
  await page.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id === 'number') {
      await chrome.storage.session.set({ [`last_allowed_url_${tab.id}`]: url });
    }
  }, allowedUrl);
  await expectBlocked(page, blockedUrl);
  await captureScreenshot(page, testInfo, 'blocked-page.png');

  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toBe(allowedUrl);
  await expect(page.getByText('Allowed page')).toBeVisible();
});

test('opens settings from the blocked page', async ({ context, extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.BLOCKED));

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage Filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('renders the blocked url and responsible filter from block id state', async ({
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://blocked-state.example.test/focus';

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-state-filter',
          pattern: 'blocked-state.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked State',
        },
      ],
      rulesVersion: 1,
    })
  );

  await expectBlocked(page, targetUrl);
  await expect(page.getByLabel('Responsible filter')).toContainText('Blocked State');
  await expect(page.getByLabel('Responsible filter')).toContainText('blocked-state.example.test');
});

test('warning blocks show Continue and allow same-tab bypass', async ({ extensionPage, page }) => {
  const targetUrl = 'https://warning-bypass.example.test/warning-focus';
  await mockAllowedPage(page, targetUrl, 'Warning bypass allowed');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      blockType: 'warning',
      filters: [
        {
          id: 'warning-filter',
          pattern: 'warning-bypass.example.test/warning',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Warning Filter',
        },
      ],
    })
  );

  await expectBlocked(page, targetUrl);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => page.url()).not.toContain(`/${PAGES.BLOCKED}`);
  await expectAllowed(page, targetUrl);
});

test('handles missing or stale block ids and no-op go back safely', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.BLOCKED));
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  const missingBlockPage = page.url();
  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect.poll(() => page.url()).toBe(missingBlockPage);

  await page.goto(
    `${extensionPage(PAGES.BLOCKED)}?url=${encodeURIComponent('https://blocked.example.invalid')}`
  );
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  await page.goto(`${extensionPage(PAGES.BLOCKED)}?blockId=missing-block`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  const staleBlockPage = page.url();
  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect.poll(() => page.url()).toBe(staleBlockPage);
});
