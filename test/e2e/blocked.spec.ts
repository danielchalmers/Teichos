import { test, expect } from './fixtures';
import { captureScreenshot, createStorageData, defaultGroup, seedStorage } from './helpers';
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

  await page.goto(`${extensionPage(PAGES.BLOCKED)}?url=${encodeURIComponent(blockedUrl)}`);
  await page.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id === 'number') {
      await chrome.storage.session.set({ [`last_allowed_url_${tab.id}`]: url });
    }
  }, allowedUrl);

  await expect(page.getByLabel('Blocked URL')).toHaveText(blockedUrl);
  await captureScreenshot(page, testInfo, 'blocked-page.png');

  await Promise.all([
    page.waitForURL(allowedUrl),
    page.getByRole('button', { name: 'Go Back' }).click(),
  ]);
  await expect(page.getByText('Allowed page')).toBeVisible();
});

test('opens settings from the blocked page', async ({ context, extensionPage, page }) => {
  await page.goto(
    `${extensionPage(PAGES.BLOCKED)}?url=${encodeURIComponent('https://blocked.example.invalid')}`
  );

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage Filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('renders the blocked url from fresh tab state when query params are missing', async ({
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
  await page.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') {
      return;
    }

    await chrome.storage.session.set({
      [`blocked_tab_state_${tab.id}`]: {
        tabId: tab.id,
        targetUrl: url,
        blockedAt: Date.now(),
        rulesVersion: 1,
        blockedBy: {
          filterId: 'blocked-state-filter',
          groupId: 'default-24x7',
        },
      },
    });
  }, targetUrl);

  await page.goto(extensionPage(PAGES.BLOCKED));

  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
});

test('handles missing or malformed blocked urls and no-op go back safely', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.BLOCKED));
  await expect(page.getByLabel('Blocked URL')).toHaveText('Unknown URL');

  const missingUrlPage = page.url();
  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect.poll(() => page.url()).toBe(missingUrlPage);

  await page.goto(`${extensionPage(PAGES.BLOCKED)}?url=%E0%A4%A`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();

  const malformedUrlPage = page.url();
  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect.poll(() => page.url()).toBe(malformedUrlPage);
});
