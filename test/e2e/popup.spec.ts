import { test, expect } from './fixtures';
import type { ClipboardCaptureGlobal } from './helpers';
import { PAGES } from '../../src/shared/constants';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  expectAllowed,
  mockAllowedPage,
  openPopup,
  readStorage,
  seedStorage,
} from './helpers';

const popupFilterData = createStorageData({
  filters: [
    {
      id: 'regular-filter',
      pattern: 'blocked.example.invalid',
      groupId: defaultGroup.id,
      enabled: true,
      matchMode: 'contains',
      description: 'Focus Block',
    },
  ],
});

async function expectTemporaryFilterExpiration(
  page: Parameters<typeof readStorage>[0],
  pattern: string,
  minMs: number,
  maxMs: number
): Promise<void> {
  const data = await readStorage(page);
  const filter = data?.filters.find((entry) => entry.pattern === pattern);

  expect(filter).toBeDefined();
  expect(typeof filter?.expiresAt).toBe('number');

  const remainingMs = (filter?.expiresAt ?? 0) - Date.now();
  expect(remainingMs).toBeGreaterThan(minMs);
  expect(remainingMs).toBeLessThan(maxMs);
}

test('adds and deletes a temporary filter from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.POPUP));

  await page.getByRole('button', { name: 'New temporary filter' }).click();
  await page.getByLabel('Site or pattern').fill('quick.example.invalid');
  await page.getByLabel('Block for').fill('45');
  await page.getByRole('button', { name: 'Start block' }).click();

  const temporaryItem = page.locator('.filter-item').filter({ hasText: 'quick.example.invalid' });
  await expect(temporaryItem).toContainText('Temporary -');

  await temporaryItem.getByRole('button', { name: 'Delete Filter' }).click();
  await expect(page.getByText('No filters configured.')).toBeVisible();
});

test('opens the full filter editor from the popup empty state', async ({
  context,
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.POPUP));

  await expect(page.getByText('No filters configured.')).toBeVisible();

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '+ New Filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.getByRole('heading', { name: 'Add Filter' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('shows the URL pattern when a filter name is blank', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'plain-url-filter',
          pattern: 'github.com/notifications',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: '',
        },
      ],
    })
  );

  await page.goto(extensionPage(PAGES.POPUP));

  await expect(
    page.locator('.filter-item').filter({ hasText: 'github.com/notifications' })
  ).toBeVisible();
});

test('supports copy, toggle, and edit actions for popup filters', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__e2eClipboardText', {
      value: '',
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (globalThis as ClipboardCaptureGlobal).__e2eClipboardText = text;
        },
      },
      configurable: true,
    });
  });

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(page, popupFilterData);
  await page.goto(extensionPage(PAGES.POPUP));

  const regularItem = page.locator('.filter-item').filter({ hasText: 'Focus Block' });

  await expect(regularItem).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-workflow.png');

  await regularItem.getByRole('button', { name: 'Copy URL' }).click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as ClipboardCaptureGlobal).__e2eClipboardText))
    .toBe('blocked.example.invalid');

  const toggle = regularItem.locator('input[type="checkbox"][data-filter-id="regular-filter"]');
  await regularItem.locator('label.toggle').click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const data = await readStorage(page);
      return data?.filters.find((filter) => filter.id === 'regular-filter')?.enabled;
    })
    .toBe(false);

  const optionsPagePromise = context.waitForEvent('page');
  await regularItem.getByRole('button', { name: 'Edit Filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.getByLabel('Name')).toHaveValue('Focus Block');
  await expect(filterModal.getByLabel('URL Pattern')).toHaveValue('blocked.example.invalid');
});

test('supports quick-add suggestions, validation, duration units, and the full editor link', async ({
  context,
  extensionPage,
  page,
}) => {
  const currentTabUrl = 'https://suggested-current-tab.example.test/focus';
  await mockAllowedPage(page, currentTabUrl, 'Suggested current tab');
  await expectAllowed(page, currentTabUrl);

  const popupPage = await openPopup(extensionPage, page);
  await popupPage.getByRole('button', { name: 'New temporary filter' }).click();

  await expect(popupPage.getByLabel('Site or pattern')).toHaveValue(currentTabUrl);

  await popupPage.getByRole('button', { name: '2h' }).click();
  await expect(popupPage.getByLabel('Block for')).toHaveValue('2');
  await expect(popupPage.getByRole('combobox')).toHaveValue('hours');

  await popupPage.getByLabel('Block for').fill('0');
  await popupPage.getByRole('button', { name: 'Start block' }).click();
  await expect(popupPage.locator('#status-message')).toHaveText('Enter a valid duration.');

  await popupPage.getByLabel('Block for').fill('2');
  await popupPage.getByRole('button', { name: 'Start block' }).click();

  const hoursFilter = popupPage.locator('.filter-item').filter({ hasText: currentTabUrl });
  await expect(hoursFilter).toContainText('Temporary - 2h left');
  await expectTemporaryFilterExpiration(page, currentTabUrl, 119 * 60_000, 121 * 60_000);

  await hoursFilter.getByRole('button', { name: 'Delete Filter' }).click();

  await popupPage.getByRole('button', { name: 'New temporary filter' }).click();
  await popupPage.getByLabel('Site or pattern').fill('multi-day.example.invalid');
  await popupPage.getByLabel('Block for').fill('3');
  await popupPage.getByRole('combobox').selectOption('days');
  await popupPage.getByRole('button', { name: 'Start block' }).click();

  const daysFilter = popupPage.locator('.filter-item').filter({ hasText: 'multi-day.example.invalid' });
  await expect(daysFilter).toContainText('Temporary - 3d left');
  await expectTemporaryFilterExpiration(
    page,
    'multi-day.example.invalid',
    3 * 24 * 60 * 60_000 - 60_000,
    3 * 24 * 60 * 60_000 + 60_000
  );

  const optionsPagePromise = context.waitForEvent('page');
  await popupPage.getByRole('button', { name: 'New temporary filter' }).click();
  await popupPage.getByRole('button', { name: /Open the full editor/ }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.locator('#filter-modal.active')).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('snoozes and resumes filtering from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'snooze-filter',
          pattern: 'snooze.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Snooze Test',
        },
      ],
    })
  );

  await page.goto(extensionPage(PAGES.POPUP));

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: '15m' }).click();
  await expect(page.locator('#snooze-label')).toContainText('Snoozed:');
  await expect(page.locator('#open-quick-add')).toBeDisabled();

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(page.locator('#open-quick-add')).toBeEnabled();
});
