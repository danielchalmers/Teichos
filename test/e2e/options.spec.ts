import { test, expect } from './fixtures';
import type { AlertCaptureGlobal } from './helpers';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  readStorage,
  seedStorage,
} from './helpers';

const OPTIONS_URL_PATTERN = /options\/index\.html$/;

test('creates, edits, and deletes a scheduled group with filters and exceptions', async ({
  extensionPage,
  page,
}, testInfo) => {
  await page.goto(extensionPage('options/index.html'));

  const groupModal = page.locator('#group-modal.active');
  await expect(page.getByRole('button', { name: 'New Group' })).toBeVisible();
  await page.getByRole('button', { name: 'New Group' }).click();
  await expect(groupModal).toBeVisible();
  await groupModal.getByLabel('Group Name').fill('Work Hours');
  await groupModal.getByRole('button', { name: 'New Schedule' }).click();
  await expect(groupModal.getByLabel('Start time for schedule 1')).toHaveValue('09:00');
  await expect(groupModal.getByLabel('End time for schedule 1')).toHaveValue('17:00');
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup).toContainText('1 schedule • 0 filters • 0 exceptions');
  await workHoursGroup.locator('summary').click();

  await workHoursGroup.getByRole('button', { name: 'New Filter' }).click();
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await filterModal.getByLabel('Name').fill('Focus Block');
  await filterModal.getByLabel('URL Pattern').fill('focus.example.com');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(workHoursGroup).toContainText('Focus Block');

  await workHoursGroup.getByRole('button', { name: 'New Exception' }).click();
  const whitelistModal = page.locator('#whitelist-modal.active');
  await expect(whitelistModal).toBeVisible();
  await whitelistModal.getByLabel('Name').fill('Allow Docs');
  await whitelistModal.getByLabel('URL Pattern').fill('focus.example.com/docs');
  await whitelistModal.getByRole('button', { name: 'Save' }).click();

  await expect(workHoursGroup).toContainText('focus.example.com/docs');
  await captureScreenshot(page, testInfo, 'options-workflow.png');

  await workHoursGroup.locator('button[data-action="edit-group"]').click();
  await expect(groupModal).toBeVisible();
  await groupModal.getByLabel('Group Name').fill('Deep Work');
  await groupModal.getByLabel('Always Active (24/7)').check();
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const deepWorkGroup = page.locator('details.group-item').filter({ hasText: 'Deep Work' });
  await expect(deepWorkGroup).toContainText('Always Active • 1 filter • 1 exception');

  await deepWorkGroup.locator('button[data-action="edit-group"]').click();
  await expect(groupModal).toBeVisible();
  await groupModal.getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('details.group-item').filter({ hasText: 'Deep Work' })).toHaveCount(0);
  const defaultGroupCard = page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' });
  await expect(defaultGroupCard).toContainText('Focus Block');
  await expect(defaultGroupCard).toContainText('focus.example.com/docs');
});

test('shows an alert for invalid regex filters', async ({ extensionPage, page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__lastAlertMessage', {
      value: '',
      writable: true,
      configurable: true,
    });
    window.alert = (message?: string): void => {
      (globalThis as AlertCaptureGlobal).__lastAlertMessage = message ?? '';
    };
  });
  await page.goto(extensionPage('options/index.html'));

  await page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' })
    .getByRole('button', { name: 'New Filter' })
    .click();

  const filterModal = page.locator('#filter-modal.active');
  await filterModal.getByLabel('URL Pattern').fill('(');
  await filterModal.getByLabel('Match Mode').selectOption('regex');

  await filterModal.getByRole('button', { name: 'Save' }).click();

  await expect(filterModal).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (globalThis as AlertCaptureGlobal).__lastAlertMessage))
    .toContain('Invalid regex pattern');
  expect((await readStorage(page)).filters).toHaveLength(0);
});

test('opens filter, group, and exception modals from query params', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage('options/index.html'));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'seeded-filter',
          pattern: 'seeded.example.com',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Seeded Filter',
        },
      ],
    })
  );

  await page.goto(extensionPage('options/index.html?modal=group'));
  await expect(page.locator('#group-modal.active')).toBeVisible();
  await expect(page).toHaveURL(OPTIONS_URL_PATTERN);
  await page.getByRole('button', { name: 'Close group dialog' }).click();

  await page.goto(extensionPage('options/index.html?modal=filter'));
  await expect(page.locator('#filter-modal.active')).toBeVisible();
  await expect(page).toHaveURL(OPTIONS_URL_PATTERN);
  await page.getByRole('button', { name: 'Close filter dialog' }).click();

  await page.goto(extensionPage('options/index.html?modal=whitelist'));
  await expect(page.locator('#whitelist-modal.active')).toBeVisible();
  await expect(page).toHaveURL(OPTIONS_URL_PATTERN);
  await page.getByRole('button', { name: 'Close exception dialog' }).click();

  await page.goto(extensionPage('options/index.html?editFilter=seeded-filter'));
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(page).toHaveURL(OPTIONS_URL_PATTERN);
  await expect(filterModal.getByRole('heading', { name: 'Edit Filter' })).toBeVisible();
  await expect(filterModal.getByRole('button', { name: 'Delete' })).toBeEnabled();
});
