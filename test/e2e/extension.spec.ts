import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';

const storageKey = 'pageblock_data';

const defaultGroup = {
  id: 'default-24x7',
  name: '24/7 (Always Active)',
  schedules: [],
  is24x7: true,
};

async function captureScreenshot(page: Page, testInfo: TestInfo, fileName: string) {
  await page.screenshot({
    path: testInfo.outputPath(fileName),
    fullPage: true,
  });
}

test('loads the extension service worker and extension pages', async ({
  extensionId,
  extensionPage,
  page,
}, testInfo) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  await page.goto(extensionPage('options/index.html'));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Group' })).toBeVisible();
  await captureScreenshot(page, testInfo, 'options-page.png');

  await page.goto(extensionPage('popup/index.html'));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByText('No filters configured.')).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-page.png');
});

test('adds a filter from the options page', async ({ extensionPage, page }, testInfo) => {
  await page.goto(extensionPage('options/index.html'));

  await page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' })
    .getByRole('button', { name: 'New Filter' })
    .click();

  const filterModal = page.locator('#filter-modal.active');
  await filterModal.getByLabel('Name').fill('E2E Block');
  await filterModal.getByLabel('URL Pattern').fill('blocked.example.invalid');
  await filterModal.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('E2E Block')).toBeVisible();
  await expect(page.getByText('blocked.example.invalid')).toBeVisible();
  await captureScreenshot(page, testInfo, 'options-filter-added.png');
});

test('redirects matching navigations to the blocked page', async ({ extensionPage, page }, testInfo) => {
  await page.goto(extensionPage('options/index.html'));
  await page.evaluate(({ key, data }) => chrome.storage.sync.set({ [key]: data }), {
    key: storageKey,
    data: {
      groups: [defaultGroup],
      filters: [
        {
          id: 'e2e-filter',
          pattern: 'blocked.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'E2E Block',
        },
      ],
      whitelist: [],
      snooze: { active: false },
    },
  });

  const targetUrl = 'https://blocked.example.invalid/focus';
  await page.goto(targetUrl).catch(() => undefined);
  await expect
    .poll(() => page.url())
    .toMatch(/chrome-extension:\/\/.*\/blocked\/index\.html\?url=/);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
  await captureScreenshot(page, testInfo, 'blocked-page.png');
});
