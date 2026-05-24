import { test, expect } from './fixtures';
import { captureScreenshot } from './helpers';
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

  await expect(page.getByRole('button', { name: 'Continue' })).toBeHidden();

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage Filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
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

test('shows continue for warning mode and continues to the target url', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://warning-blocked.example.test/focus';

  await context.route(targetUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Warning target</title><main>Warning target</main>',
    });
  });

  await page.goto(
    `${extensionPage(PAGES.BLOCKED)}?url=${encodeURIComponent(targetUrl)}&mode=warning`
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
        blockType: 'warning',
        blockedAt: Date.now(),
        rulesVersion: 1,
        blockedBy: {
          filterId: 'warning-filter',
          groupId: 'default-24x7',
        },
      },
      [`pageblock_data`]: undefined,
    });
    await chrome.storage.sync.set({
      pageblock_data: {
        groups: [{ id: 'default-24x7', name: '24/7 (Always Active)', schedules: [], is24x7: true }],
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning-blocked.example.test',
            groupId: 'default-24x7',
            enabled: true,
            matchMode: 'contains',
            blockType: 'warning',
          },
        ],
        whitelist: [],
        blockType: 'block',
        snooze: { active: false },
        rulesVersion: 1,
      },
    });
  }, targetUrl);

  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Warning' })).toBeVisible();
  await captureScreenshot(page, testInfo, 'blocked-warning-continue.png');

  await Promise.all([
    page.waitForURL(targetUrl),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);
  await expect(page.getByText('Warning target')).toBeVisible();
});
