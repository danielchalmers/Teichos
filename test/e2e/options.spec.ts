import { readFile } from 'fs/promises';
import { test, expect } from './fixtures';
import type { AlertCaptureGlobal } from './helpers';
import { PAGES } from '../../src/shared/constants';
import {
  captureScreenshot,
  createStorageData,
  createFilterViaOptions,
  createWhitelistViaOptions,
  defaultGroup,
  openPopup,
  readStorage,
  seedStorage,
} from './helpers';

const OPTIONS_PATHNAME = `/${PAGES.OPTIONS}`;

test('shows schedule hints in the group header', async ({ extensionPage, page }, testInfo) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'work-hours',
          name: 'Work Hours',
          is24x7: false,
          schedules: [
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
            { daysOfWeek: [6], startTime: '10:00', endTime: '12:00' },
          ],
        },
      ],
    })
  );

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup).toContainText(
    'Mo-Fr 09:00-17:00, Sa 10:00-12:00 • 0 filters • 0 exceptions'
  );
  await captureScreenshot(page, testInfo, 'options-schedule-hint.png');
});

test('creates, edits, and deletes a scheduled group with filters and exceptions', async ({
  extensionPage,
  page,
}, testInfo) => {
  await page.goto(extensionPage(PAGES.OPTIONS));

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
  await expect(workHoursGroup).toContainText('Mo-Fr 09:00-17:00 • 0 filters • 0 exceptions');
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
  await page.goto(extensionPage(PAGES.OPTIONS));

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
  await expect.poll(() => readStorage(page)).toBeUndefined();
});

test('exports current settings from global settings', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  const expectedData = createStorageData({
    groups: [
      defaultGroup,
      {
        id: 'work-hours',
        name: 'Work Hours',
        is24x7: false,
        schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
      },
    ],
    filters: [
      {
        id: 'focus-filter',
        pattern: 'focus.example.test',
        groupId: 'work-hours',
        enabled: true,
        matchMode: 'contains',
        description: 'Focus Filter',
      },
    ],
    whitelist: [
      {
        id: 'allow-docs',
        pattern: 'focus.example.test/docs',
        groupId: 'work-hours',
        enabled: true,
        matchMode: 'contains',
        description: 'Allow Docs',
      },
    ],
    snooze: { active: true, until: 1_234_567_890 },
    rulesVersion: 7,
  });
  await seedStorage(page, expectedData);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Settings' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();

  expect(downloadPath).not.toBeNull();
  expect(JSON.parse(await readFile(downloadPath!, 'utf8'))).toEqual(expectedData);
  await expect(page.locator('#global-settings-status')).toHaveText('Settings exported successfully.');
});

test('imports settings from global settings', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'old-filter',
          pattern: 'old.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Old Filter',
        },
      ],
      rulesVersion: 0,
    })
  );

  const importedData = createStorageData({
    groups: [
      defaultGroup,
      {
        id: 'imported-group',
        name: 'Imported Group',
        is24x7: false,
        schedules: [{ daysOfWeek: [1, 3, 5], startTime: '08:00', endTime: '12:00' }],
      },
    ],
    filters: [
      {
        id: 'imported-filter',
        pattern: 'imported.example.test',
        groupId: 'imported-group',
        enabled: true,
        matchMode: 'contains',
        description: 'Imported Filter',
      },
    ],
    whitelist: [
      {
        id: 'imported-exception',
        pattern: 'imported.example.test/docs',
        groupId: 'imported-group',
        enabled: true,
        matchMode: 'exact',
        description: 'Imported Exception',
      },
    ],
    snooze: { active: true, until: 9_999_999_999_999 },
    rulesVersion: 5,
  });

  await page.locator('#import-settings-input').setInputFiles({
    name: 'teichos-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedData)),
  });

  const importedGroup = page.locator('details.group-item').filter({ hasText: 'Imported Group' });
  await expect(importedGroup).toContainText('Imported Filter');
  await expect(importedGroup).toContainText('Imported Exception');
  await expect(page.locator('#global-settings-status')).toHaveText('Settings imported successfully.');
  await expect
    .poll(() => readStorage(page))
    .toMatchObject({
      groups: importedData.groups,
      filters: importedData.filters,
      whitelist: importedData.whitelist,
      snooze: importedData.snooze,
      rulesVersion: 1,
    });
});

test('keeps existing settings when global settings import fails', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  const originalData = createStorageData({
    filters: [
      {
        id: 'existing-filter',
        pattern: 'existing.example.test',
        groupId: defaultGroup.id,
        enabled: true,
        matchMode: 'contains',
        description: 'Existing Filter',
      },
    ],
    rulesVersion: 3,
  });
  await seedStorage(page, originalData);

  await page.locator('#import-settings-input').setInputFiles({
    name: 'broken-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });

  await expect(page.locator('#global-settings-status')).toHaveText(
    'Settings file is not valid JSON.'
  );
  await expect.poll(() => readStorage(page)).toEqual(originalData);
});

test('opens filter, group, and exception modals from query params', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
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

  await page.goto(extensionPage(`${PAGES.OPTIONS}?modal=group`));
  await expect(page.locator('#group-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close group dialog' }).click();

  await page.goto(extensionPage(`${PAGES.OPTIONS}?modal=filter`));
  await expect(page.locator('#filter-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close filter dialog' }).click();

  await page.goto(extensionPage(`${PAGES.OPTIONS}?modal=whitelist`));
  await expect(page.locator('#whitelist-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close exception dialog' }).click();

  await page.goto(extensionPage(`${PAGES.OPTIONS}?editFilter=seeded-filter`));
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await expect(filterModal.getByRole('heading', { name: 'Edit Filter' })).toBeVisible();
  await expect(filterModal.getByRole('button', { name: 'Delete' })).toBeEnabled();
});

test('opens the about panel from query params and closes it when popup settings are opened', async ({
  extensionPage,
  page,
}) => {
  const optionsPage = page;
  await optionsPage.goto(extensionPage(`${PAGES.OPTIONS}?info=1`));

  const infoPopover = optionsPage.locator('.info-popover');
  const infoButton = optionsPage.getByRole('button', { name: 'About' });
  await expect(infoPopover).toHaveClass(/is-open/);
  await expect(infoButton).toHaveAttribute('aria-expanded', 'true');
  await expect(optionsPage.locator('#info-version')).not.toHaveText('--');
  await expect.poll(() => new URL(optionsPage.url()).search).toBe('');

  const popupPage = await openPopup(extensionPage, optionsPage);
  await popupPage.getByRole('button', { name: 'Settings' }).click();

  await expect(infoButton).toHaveAttribute('aria-expanded', 'false');
  await expect(infoPopover).not.toHaveClass(/is-open/);
});

test('edits and deletes individual filters and exceptions from options', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await createFilterViaOptions(page, {
    name: 'Editable Filter',
    pattern: 'editable-filter.example.test',
  });
  await createWhitelistViaOptions(page, {
    name: 'Editable Exception',
    pattern: 'editable-filter.example.test/docs',
  });

  const defaultGroupCard = page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' });

  const filterItem = defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Editable Filter' });
  await filterItem.getByRole('button', { name: 'Edit' }).click();
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await filterModal.getByLabel('Name').fill('Updated Filter');
  await filterModal.getByLabel('URL Pattern').fill('https://editable-filter.example.test/focus');
  await filterModal.getByLabel('Match Mode').selectOption('exact');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(defaultGroupCard).toContainText('Updated Filter');
  await expect(defaultGroupCard).toContainText('https://editable-filter.example.test/focus');

  const exceptionItem = defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Editable Exception' });
  await exceptionItem.getByRole('button', { name: 'Edit' }).click();
  const whitelistModal = page.locator('#whitelist-modal.active');
  await expect(whitelistModal).toBeVisible();
  await whitelistModal.getByLabel('Name').fill('Updated Exception');
  await whitelistModal
    .getByLabel('URL Pattern')
    .fill('^https://editable-filter\\.example\\.test/docs/\\d+$');
  await whitelistModal.getByLabel('Match Mode').selectOption('regex');
  await whitelistModal.getByRole('button', { name: 'Save' }).click();
  await expect(defaultGroupCard).toContainText('Updated Exception');
  await expect(defaultGroupCard).toContainText(
    '^https://editable-filter\\.example\\.test/docs/\\d+$'
  );

  await defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Updated Filter' })
    .getByRole('button', { name: 'Edit' })
    .click();
  await page.locator('#filter-modal.active').getByRole('button', { name: 'Delete' }).click();
  await expect(
    defaultGroupCard.locator('.filter-item').filter({ hasText: 'Updated Filter' })
  ).toHaveCount(0);

  await defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Updated Exception' })
    .getByRole('button', { name: 'Edit' })
    .click();
  await page.locator('#whitelist-modal.active').getByRole('button', { name: 'Delete' }).click();
  await expect(
    defaultGroupCard.locator('.filter-item').filter({ hasText: 'Updated Exception' })
  ).toHaveCount(0);

  await expect(defaultGroupCard.getByText('No filters in this group.')).toBeVisible();
  await expect(defaultGroupCard.getByText('No exceptions in this group.')).toBeVisible();
  await expect
    .poll(() => readStorage(page))
    .toMatchObject({
      filters: [],
      whitelist: [],
    });
});

test('updates selected days and supports empty schedules in the group editor', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));

  await page.getByRole('button', { name: 'New Group' }).click();
  const groupModal = page.locator('#group-modal.active');
  await expect(groupModal).toBeVisible();
  await groupModal.getByLabel('Group Name').fill('Flexible Hours');
  await groupModal.getByRole('button', { name: 'New Schedule' }).click();

  const firstSchedule = groupModal.locator('#schedules-list .schedule-item').first();
  const firstDayCheckboxes = firstSchedule.locator('label.day-checkbox input');
  for (const dayIndex of [1, 2, 3, 4, 5]) {
    await firstDayCheckboxes.nth(dayIndex).click();
  }
  await firstDayCheckboxes.nth(0).click();
  await firstDayCheckboxes.nth(6).click();
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const flexibleHoursGroup = page
    .locator('details.group-item')
    .filter({ hasText: 'Flexible Hours' });
  await expect(flexibleHoursGroup).toContainText('Su, Sa 09:00-17:00 • 0 filters • 0 exceptions');

  await flexibleHoursGroup.locator('button[data-action="edit-group"]').click();
  await page
    .locator('#group-modal.active')
    .getByRole('button', { name: 'Delete schedule 1' })
    .click();
  await page.locator('#group-modal.active').getByRole('button', { name: 'Save' }).click();
  await expect(flexibleHoursGroup).toContainText('0 schedules • 0 filters • 0 exceptions');

  await flexibleHoursGroup.locator('button[data-action="edit-group"]').click();
  const emptyDaysModal = page.locator('#group-modal.active');
  await emptyDaysModal.getByRole('button', { name: 'New Schedule' }).click();
  const emptyDaysSchedule = emptyDaysModal.locator('#schedules-list .schedule-item').first();
  const emptyDaysCheckboxes = emptyDaysSchedule.locator('label.day-checkbox input');
  for (const dayIndex of [1, 2, 3, 4, 5]) {
    await emptyDaysCheckboxes.nth(dayIndex).click();
  }
  await emptyDaysModal.getByRole('button', { name: 'Save' }).click();

  await expect(flexibleHoursGroup).toContainText('No days 09:00-17:00 • 0 filters • 0 exceptions');
});
