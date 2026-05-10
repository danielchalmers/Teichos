import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  readStorage,
  seedStorage,
} from './helpers';

test('creates, edits, and deletes a scheduled group with filters and exceptions', async ({
  extensionPage,
  page,
}, testInfo) => {
  await page.goto(extensionPage('options/index.html'));

  await page.getByRole('button', { name: 'New Group' }).click();

  const groupModal = page.locator('#group-modal.active');
  await groupModal.getByLabel('Group Name').fill('Work Hours');
  await groupModal.getByRole('button', { name: 'New Schedule' }).click();
  await expect(groupModal.getByLabel('Start time for schedule 1')).toHaveValue('09:00');
  await expect(groupModal.getByLabel('End time for schedule 1')).toHaveValue('17:00');
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup).toContainText('1 schedule • 0 filters • 0 exceptions');

  await workHoursGroup.getByRole('button', { name: 'New Filter' }).click();
  const filterModal = page.locator('#filter-modal.active');
  await filterModal.getByLabel('Name').fill('Focus Block');
  await filterModal.getByLabel('URL Pattern').fill('focus.example.com');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(workHoursGroup).toContainText('Focus Block');

  await workHoursGroup.getByRole('button', { name: 'New Exception' }).click();
  const whitelistModal = page.locator('#whitelist-modal.active');
  await whitelistModal.getByLabel('Name').fill('Allow Docs');
  await whitelistModal.getByLabel('URL Pattern').fill('focus.example.com/docs');
  await whitelistModal.getByRole('button', { name: 'Save' }).click();

  await expect(workHoursGroup).toContainText('Allow Docs');
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
  await expect(defaultGroupCard).toContainText('Allow Docs');
});

test('shows an alert for invalid regex filters', async ({ extensionPage, page }) => {
  await page.goto(extensionPage('options/index.html'));

  await page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' })
    .getByRole('button', { name: 'New Filter' })
    .click();

  const filterModal = page.locator('#filter-modal.active');
  await filterModal.getByLabel('URL Pattern').fill('(');
  await filterModal.getByLabel('Match Mode').selectOption('regex');

  const dialogPromise = page.waitForEvent('dialog');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Invalid regex pattern');
  await dialog.accept();

  await expect(filterModal).toBeVisible();
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
  await expect(page).toHaveURL(/options\/index\.html$/);
  await page.getByRole('button', { name: 'Close group dialog' }).click();

  await page.goto(extensionPage('options/index.html?modal=filter'));
  await expect(page.locator('#filter-modal.active')).toBeVisible();
  await expect(page).toHaveURL(/options\/index\.html$/);
  await page.getByRole('button', { name: 'Close filter dialog' }).click();

  await page.goto(extensionPage('options/index.html?modal=whitelist'));
  await expect(page.locator('#whitelist-modal.active')).toBeVisible();
  await expect(page).toHaveURL(/options\/index\.html$/);
  await page.getByRole('button', { name: 'Close exception dialog' }).click();

  await page.goto(extensionPage('options/index.html?editFilter=seeded-filter'));
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(page).toHaveURL(/options\/index\.html$/);
  await expect(filterModal.getByLabel('Name')).toHaveValue('Seeded Filter');
  await expect(filterModal.getByLabel('URL Pattern')).toHaveValue('seeded.example.com');
});
