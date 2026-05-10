import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
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
    {
      id: 'temporary-filter',
      pattern: 'temporary.example.invalid',
      groupId: defaultGroup.id,
      enabled: true,
      matchMode: 'contains',
      expiresAt: Date.now() + 30 * 60_000,
    },
  ],
});

test('adds and deletes a temporary filter from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage('popup/index.html'));

  await page.getByRole('button', { name: 'New temporary filter' }).click();
  await page.getByLabel('Site or pattern').fill('quick.example.invalid');
  await page.getByLabel('Block for').fill('45');
  await page.getByRole('button', { name: 'Start block' }).click();

  const temporaryItem = page.locator('.filter-item').filter({ hasText: 'quick.example.invalid' });
  await expect(temporaryItem).toContainText('Temporary -');

  await temporaryItem.getByRole('button', { name: 'Delete Filter' }).click();
  await expect(page.getByText('No filters configured.')).toBeVisible();
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
          (globalThis as typeof globalThis & { __e2eClipboardText?: string }).__e2eClipboardText =
            text;
        },
      },
      configurable: true,
    });
  });

  await page.goto(extensionPage('options/index.html'));
  await seedStorage(page, popupFilterData);
  await page.goto(extensionPage('popup/index.html'));

  const temporaryItem = page
    .locator('.filter-item')
    .filter({ hasText: 'temporary.example.invalid' });
  const regularItem = page.locator('.filter-item').filter({ hasText: 'Focus Block' });

  await expect(temporaryItem).toBeVisible();
  await expect(regularItem).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-workflow.png');

  await regularItem.getByRole('button', { name: 'Copy URL' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __e2eClipboardText?: string }).__e2eClipboardText)
    )
    .toBe('blocked.example.invalid');

  const toggle = regularItem.locator('input[type="checkbox"][data-filter-id="regular-filter"]');
  await toggle.setChecked(false, { force: true });
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const data = await readStorage(page);
      return data.filters.find((filter) => filter.id === 'regular-filter')?.enabled;
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

test('snoozes and resumes filtering from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage('options/index.html'));
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

  await page.goto(extensionPage('popup/index.html'));

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: '15m' }).click();
  await expect(page.locator('#snooze-label')).toContainText('Snoozed:');
  await expect(page.locator('#open-quick-add')).toBeDisabled();

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(page.locator('#open-quick-add')).toBeEnabled();
});
