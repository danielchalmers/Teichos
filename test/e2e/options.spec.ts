import { readFile } from 'fs/promises';
import { test, expect } from './fixtures';
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
  waitForOptionsReady,
} from './helpers';

const OPTIONS_PATHNAME = `/${PAGES.OPTIONS}`;

async function gotoOptions(
  extensionPage: (relativePath: string) => string,
  page: Parameters<typeof waitForOptionsReady>[0],
  path: string = PAGES.OPTIONS
): Promise<void> {
  await page.goto(extensionPage(path));
  await waitForOptionsReady(page);
}

test('shows schedule hints in the group header', async ({ extensionPage, page }, testInfo) => {
  await gotoOptions(extensionPage, page);
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

  const workHoursGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup.locator('[data-role="group-meta"]')).toHaveText(
    'Mon–Fri 09:00–17:00; Sat 10:00–12:00 · 0 filters · 0 exceptions'
  );
  // The default group's name already says when it applies, so its meta line only counts.
  const defaultGroupCard = page.locator('.group-item').filter({ hasText: defaultGroup.name });
  await expect(defaultGroupCard.locator('[data-role="group-meta"]')).toHaveText(
    '0 filters · 0 exceptions'
  );
  await captureScreenshot(page, testInfo, 'options-schedule-hint.png');
});

test('creates, edits, and deletes a scheduled group with filters and exceptions', async ({
  extensionPage,
  page,
}, testInfo) => {
  await gotoOptions(extensionPage, page);

  const groupModal = page.locator('#group-modal.active');
  await expect(page.getByRole('button', { name: 'New group' })).toBeVisible();
  await page.getByRole('button', { name: 'New group' }).click();
  await expect(groupModal).toBeVisible();
  await expect(groupModal.getByRole('heading', { name: 'New group' })).toBeVisible();
  await groupModal.locator('#group-name').fill('Work Hours');
  await groupModal.getByRole('button', { name: 'New schedule' }).click();
  await expect(groupModal.getByLabel('Start time for schedule 1')).toHaveValue('09:00');
  await expect(groupModal.getByLabel('End time for schedule 1')).toHaveValue('17:00');
  await groupModal.getByRole('button', { name: 'Save' }).click();

  // Focus returns to the page after each save, so the result is also announced.
  const status = page.locator('#status-message');
  const workHoursGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup).toContainText('Mon–Fri 09:00–17:00 · 0 filters · 0 exceptions');
  await expect(status).toHaveText('Group added.');
  await workHoursGroup.getByRole('button', { name: 'Work Hours', exact: true }).click();

  await workHoursGroup.getByRole('button', { name: 'New filter' }).click();
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await filterModal.locator('#filter-description').fill('Focus Block');
  await filterModal.locator('#filter-pattern').fill('focus.example.com');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(workHoursGroup).toContainText('Focus Block');
  await expect(status).toHaveText('Filter added.');

  await workHoursGroup.getByRole('button', { name: 'New exception' }).click();
  const whitelistModal = page.locator('#whitelist-modal.active');
  await expect(whitelistModal).toBeVisible();
  await whitelistModal.locator('#whitelist-description').fill('Allow Docs');
  await whitelistModal.locator('#whitelist-pattern').fill('focus.example.com/docs');
  await whitelistModal.getByRole('button', { name: 'Save' }).click();

  await expect(workHoursGroup).toContainText('focus.example.com/docs');
  await expect(status).toHaveText('Exception added.');
  await captureScreenshot(page, testInfo, 'options-workflow.png');

  await workHoursGroup.locator('button[data-action="edit-group"]').click();
  await expect(groupModal).toBeVisible();
  await groupModal.locator('#group-name').fill('Deep Work');
  await groupModal.getByLabel('Always active (24/7)').check();
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const deepWorkGroup = page.locator('.group-item').filter({ hasText: 'Deep Work' });
  await expect(deepWorkGroup).toContainText('Always active · 1 filter · 1 exception');
  await expect(status).toHaveText('Group saved.');

  await deepWorkGroup.locator('button[data-action="edit-group"]').click();
  await expect(groupModal).toBeVisible();
  await expect(groupModal.getByRole('heading', { name: 'Edit group' })).toBeVisible();
  // Deleting takes a second step that says where the group's filters and exceptions go.
  await groupModal.getByRole('button', { name: 'Delete' }).click();
  await expect(groupModal.locator('#group-delete-prompt')).toHaveText(
    'Delete “Deep Work”? Its 1 filter and 1 exception move to 24/7 (Always Active).'
  );
  await groupModal.getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('.group-item').filter({ hasText: 'Deep Work' })).toHaveCount(0);
  // The deleted group's Edit button is gone, so focus falls back to New group, not the body, and
  // the announcement says where the group's contents went.
  await expect(page.getByRole('button', { name: 'New group' })).toBeFocused();
  await expect(status).toHaveText(
    'Group deleted. Its 1 filter and 1 exception moved to 24/7 (Always Active).'
  );
  const defaultGroupCard = page.locator('.group-item').filter({ hasText: '24/7 (Always Active)' });
  await expect(defaultGroupCard).toContainText('Focus Block');
  await expect(defaultGroupCard).toContainText('focus.example.com/docs');
});

test('shows dialog errors inline and ties them to the field', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);

  await page
    .locator('.group-item')
    .filter({ hasText: '24/7 (Always Active)' })
    .getByRole('button', { name: 'New filter' })
    .click();

  const filterModal = page.locator('#filter-modal.active');
  const patternInput = filterModal.locator('#filter-pattern');
  const filterError = filterModal.locator('#filter-error');
  await expect(filterError).toBeHidden();

  // Native validation is off, so an empty pattern reaches the handler and is reported inline.
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(filterError).toHaveText('Enter a pattern to match.');
  await expect(patternInput).toHaveAttribute('aria-invalid', 'true');
  await expect(patternInput).toHaveAttribute('aria-describedby', 'filter-error');
  await expect(patternInput).toBeFocused();

  await patternInput.fill('(');
  await expect(filterError).toBeHidden();
  await expect(patternInput).not.toHaveAttribute('aria-invalid');

  await filterModal.locator('#filter-match-mode').selectOption('regex');
  await filterModal.getByRole('button', { name: 'Save' }).click();

  await expect(filterModal).toBeVisible();
  // The engine's message repeats the pattern; only its reason is shown.
  await expect(filterError).toHaveText('Invalid regular expression: unterminated group.');
  await expect(patternInput).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#status-message')).toHaveText(
    'Invalid regular expression: unterminated group.'
  );
  expect(await readStorage(page)).toBeUndefined();

  // A failed write is reported in the dialog, which stays open so nothing typed is lost.
  await page.evaluate(() => {
    chrome.storage.sync.set = (): Promise<void> =>
      Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
  });
  await patternInput.fill('reddit.com');
  await filterModal.locator('#filter-match-mode').selectOption('contains');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(filterError).toContainText('Browser sync storage is full');
  await expect(filterModal).toBeVisible();

  // Reopening the dialog starts without the previous error.
  await filterModal.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('button[data-action="add-filter"]').first().click();
  await expect(page.locator('#filter-modal.active')).toBeVisible();
  await expect(page.locator('#filter-error')).toBeHidden();
});

test('exports current settings from global settings', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);
  const expectedData = createStorageData({
    groups: [
      defaultGroup,
      {
        id: 'work-hours',
        name: 'Work Hours',
        is24x7: false,
        schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
        enabled: true,
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
    // Far in the future on purpose: an expired snooze would trip the
    // background's clear-expired-snooze pass, whose normalized write-back races
    // both the raw snapshot below and the export itself.
    snooze: { active: true, until: 9_999_999_999_999 },
    rulesVersion: 7,
  });
  await seedStorage(page, expectedData);
  const currentData = await readStorage(page);
  // The seed is a fixed point of normalization, so nothing may have rewritten
  // it between the seed and the snapshot; a mismatch here means the fixture
  // regressed into something the background reconciles.
  expect(currentData).toEqual(expectedData);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export settings' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();

  expect(downloadPath).not.toBeNull();
  expect(JSON.parse(await readFile(downloadPath!, 'utf8'))).toEqual(currentData);
  await expect(page.locator('#global-settings-status')).toHaveText(
    'Settings exported successfully.'
  );
});

test('imports settings from global settings', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);
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

  const importedGroup = page.locator('.group-item').filter({ hasText: 'Imported Group' });
  await expect(importedGroup).toContainText('Imported Filter');
  await expect(importedGroup).toContainText('Imported Exception');
  await expect(page.locator('#global-settings-status')).toHaveText(
    'Settings imported successfully.'
  );
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

test('keeps existing settings when global settings import fails', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
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
  expect(await readStorage(page)).toEqual(originalData);
});

test('opens filter, group, and exception modals from query params', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
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

  // A deep-linked modal has no opener, so closing it moves focus to the control that would have
  // opened it instead of leaving it on the body.
  const newGroupButton = page.getByRole('button', { name: 'New group' });
  const defaultGroupDisclosure = page
    .locator('.group-item')
    .filter({ hasText: defaultGroup.name })
    .locator('.group-disclosure');
  const seededFilterEdit = page.locator(
    '[data-action="edit-filter"][data-filter-id="seeded-filter"]'
  );

  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?modal=group`);
  await expect(page.locator('#group-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close group dialog' }).click();
  await expect(newGroupButton).toBeFocused();

  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?modal=filter`);
  await expect(page.locator('#filter-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close filter dialog' }).click();
  await expect(defaultGroupDisclosure).toBeFocused();

  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?modal=whitelist`);
  await expect(page.locator('#whitelist-modal.active')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await page.getByRole('button', { name: 'Close exception dialog' }).click();
  await expect(defaultGroupDisclosure).toBeFocused();

  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?editFilter=seeded-filter`);
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(OPTIONS_PATHNAME);
  await expect(filterModal.getByRole('heading', { name: 'Edit filter' })).toBeVisible();
  await expect(filterModal.getByRole('button', { name: 'Delete' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(filterModal).toHaveCount(0);
  await expect(seededFilterEdit).toBeFocused();

  // Deleting the deep-linked filter removes its Edit button, so focus falls back to its group.
  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?editFilter=seeded-filter`);
  await filterModal.getByRole('button', { name: 'Delete' }).click();
  await filterModal.getByRole('button', { name: 'Delete' }).click();
  await expect(seededFilterEdit).toHaveCount(0);
  await expect(defaultGroupDisclosure).toBeFocused();
});

test('opens the about panel from query params and closes it when popup settings are opened', async ({
  extensionPage,
  page,
}) => {
  const optionsPage = page;
  await gotoOptions(extensionPage, optionsPage, `${PAGES.OPTIONS}?info=1`);

  const infoPopover = optionsPage.locator('.info-popover');
  const infoButton = optionsPage.getByRole('button', { name: 'About' });
  await expect(infoPopover).toHaveClass(/is-open/);
  await expect(infoButton).toHaveAttribute('aria-expanded', 'true');
  await expect(optionsPage.locator('#info-version')).not.toHaveText('--');
  await expect(optionsPage.locator('#info-copyright')).toHaveText(/^© \d{4} Daniel Chalmers$/);
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
  await gotoOptions(extensionPage, page);
  await createFilterViaOptions(page, {
    name: 'Editable Filter',
    pattern: 'editable-filter.example.test',
  });
  await createWhitelistViaOptions(page, {
    name: 'Editable Exception',
    pattern: 'editable-filter.example.test/docs',
  });

  const defaultGroupCard = page.locator('.group-item').filter({ hasText: '24/7 (Always Active)' });

  const filterItem = defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Editable Filter' });
  await filterItem.getByRole('button', { name: 'Edit' }).click();
  const filterModal = page.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.locator('#filter-pattern')).toBeFocused();
  await filterModal.locator('#filter-description').fill('Updated Filter');
  await filterModal.locator('#filter-pattern').fill('https://editable-filter.example.test/focus');
  await filterModal.locator('#filter-match-mode').selectOption('exact');
  await filterModal.getByRole('button', { name: 'Save' }).click();
  await expect(defaultGroupCard).toContainText('Updated Filter');
  await expect(defaultGroupCard).toContainText('https://editable-filter.example.test/focus');
  const status = page.locator('#status-message');
  await expect(status).toHaveText('Filter saved.');

  const exceptionItem = defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Editable Exception' });
  await exceptionItem.getByRole('button', { name: 'Edit' }).click();
  const whitelistModal = page.locator('#whitelist-modal.active');
  await expect(whitelistModal).toBeVisible();
  await expect(whitelistModal.locator('#whitelist-pattern')).toBeFocused();
  await whitelistModal.locator('#whitelist-description').fill('Updated Exception');
  await whitelistModal
    .locator('#whitelist-pattern')
    .fill('^https://editable-filter\\.example\\.test/docs/\\d+$');
  await whitelistModal.locator('#whitelist-match-mode').selectOption('regex');
  await whitelistModal.getByRole('button', { name: 'Save' }).click();
  await expect(defaultGroupCard).toContainText('Updated Exception');
  await expect(defaultGroupCard).toContainText(
    '^https://editable-filter\\.example\\.test/docs/\\d+$'
  );
  await expect(status).toHaveText('Exception saved.');

  await defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Updated Filter' })
    .getByRole('button', { name: 'Edit' })
    .click();
  const deleteFilterModal = page.locator('#filter-modal.active');
  await deleteFilterModal.getByRole('button', { name: 'Delete' }).click();
  await deleteFilterModal.getByRole('button', { name: 'Delete' }).click();
  await expect(
    defaultGroupCard.locator('.filter-item').filter({ hasText: 'Updated Filter' })
  ).toHaveCount(0);
  // The deleted filter's Edit button is gone, so focus returns to its group, not the body, and
  // the announcement confirms the delete.
  await expect(defaultGroupCard.locator('.group-disclosure')).toBeFocused();
  await expect(status).toHaveText('Filter deleted.');

  await defaultGroupCard
    .locator('.filter-item')
    .filter({ hasText: 'Updated Exception' })
    .getByRole('button', { name: 'Edit' })
    .click();
  const deleteWhitelistModal = page.locator('#whitelist-modal.active');
  await deleteWhitelistModal.getByRole('button', { name: 'Delete' }).click();
  await expect(deleteWhitelistModal.locator('#whitelist-delete-prompt')).toHaveText(
    "Delete “Updated Exception”? This can't be undone."
  );
  await deleteWhitelistModal.getByRole('button', { name: 'Delete' }).click();
  await expect(
    defaultGroupCard.locator('.filter-item').filter({ hasText: 'Updated Exception' })
  ).toHaveCount(0);
  await expect(status).toHaveText('Exception deleted.');

  await expect(defaultGroupCard.getByText('No filters in this group.')).toBeVisible();
  await expect(defaultGroupCard.getByText('No exceptions in this group.')).toBeVisible();
  await expect
    .poll(() => readStorage(page))
    .toMatchObject({
      filters: [],
      whitelist: [],
    });
});

test('updates selected days and rejects schedules with no days in the group editor', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);

  await page.getByRole('button', { name: 'New group' }).click();
  const groupModal = page.locator('#group-modal.active');
  await expect(groupModal).toBeVisible();
  // A group that is not 24/7 does nothing until it has a schedule, so the empty list says so.
  const emptySchedulesHint = groupModal.getByText(
    'Add a schedule to choose when this group blocks.'
  );
  await expect(emptySchedulesHint).toBeVisible();

  const groupName = groupModal.locator('#group-name');
  await groupModal.getByRole('button', { name: 'Save' }).click();
  await expect(groupModal.locator('#group-error')).toHaveText('Enter a group name.');
  await expect(groupName).toHaveAttribute('aria-invalid', 'true');
  await expect(groupName).toBeFocused();

  await groupName.fill('Flexible Hours');
  await expect(groupModal.locator('#group-error')).toBeHidden();
  await groupModal.getByRole('button', { name: 'New schedule' }).click();
  await expect(emptySchedulesHint).toBeHidden();

  const firstSchedule = groupModal.locator('#schedules-list .schedule-item').first();
  const firstDayCheckboxes = firstSchedule.locator('label.day-checkbox input');
  for (const dayIndex of [1, 2, 3, 4, 5]) {
    await firstDayCheckboxes.nth(dayIndex).click();
  }
  await firstDayCheckboxes.nth(0).click();
  await firstDayCheckboxes.nth(6).click();
  await groupModal.getByRole('button', { name: 'Save' }).click();

  const flexibleHoursGroup = page.locator('.group-item').filter({ hasText: 'Flexible Hours' });
  await expect(flexibleHoursGroup).toContainText('Sun, Sat 09:00–17:00 · 0 filters · 0 exceptions');

  await flexibleHoursGroup.locator('button[data-action="edit-group"]').click();
  await page
    .locator('#group-modal.active')
    .getByRole('button', { name: 'Delete schedule 1' })
    .click();
  await page.locator('#group-modal.active').getByRole('button', { name: 'Save' }).click();
  await expect(flexibleHoursGroup).toContainText('No schedule · 0 filters · 0 exceptions');

  await flexibleHoursGroup.locator('button[data-action="edit-group"]').click();
  const emptyDaysModal = page.locator('#group-modal.active');
  await emptyDaysModal.getByRole('button', { name: 'New schedule' }).click();
  const emptyDaysSchedule = emptyDaysModal.locator('#schedules-list .schedule-item').first();
  const emptyDaysCheckboxes = emptyDaysSchedule.locator('label.day-checkbox input');
  for (const dayIndex of [1, 2, 3, 4, 5]) {
    await emptyDaysCheckboxes.nth(dayIndex).click();
  }
  await emptyDaysModal.getByRole('button', { name: 'Save' }).click();

  // A schedule with no selected days can never activate, so the save is rejected.
  await expect(emptyDaysModal).toBeVisible();
  await expect(emptyDaysModal.locator('#group-error')).toHaveText(
    'Each schedule needs at least one day selected.'
  );
  const emptyDayGroup = emptyDaysModal.getByRole('group', { name: 'Days for schedule 1' });
  await expect(emptyDayGroup).toHaveAttribute('aria-invalid', 'true');
  await expect(emptyDayGroup).toHaveAttribute('aria-describedby', 'group-error');
  await expect(emptyDaysCheckboxes.first()).toBeFocused();

  // Rebuilding the schedule list drops the error rather than leaving it detached from any field.
  // The removed schedule's button is gone, so focus moves on to New schedule.
  await emptyDaysModal.getByRole('button', { name: 'Delete schedule 1' }).click();
  await expect(emptyDaysModal.locator('#group-error')).toBeHidden();
  await expect(emptyDaysModal.getByRole('button', { name: 'New schedule' })).toBeFocused();

  // With validation handled in the dialog, a partly cleared time is caught there too: it would
  // otherwise save a schedule that can never run.
  await emptyDaysModal.getByRole('button', { name: 'New schedule' }).click();
  const startTime = emptyDaysModal.getByLabel('Start time for schedule 1');
  await startTime.fill('');
  await emptyDaysModal.getByRole('button', { name: 'Save' }).click();
  await expect(emptyDaysModal.locator('#group-error')).toHaveText(
    'Enter a start and end time for each schedule.'
  );
  await expect(startTime).toHaveAttribute('aria-invalid', 'true');
  await expect(startTime).toBeFocused();

  await emptyDaysModal.getByRole('button', { name: 'Cancel' }).click();
  await expect(flexibleHoursGroup).toContainText('No schedule · 0 filters · 0 exceptions');
});

test('disabled groups start collapsed and stay readonly until re-enabled', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'work-hours',
          name: 'Work Hours',
          is24x7: true,
          schedules: [],
          enabled: false,
        },
      ],
      filters: [
        {
          id: 'focus-filter',
          pattern: 'focus.example.test',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Focus Block',
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
    })
  );

  const workHoursGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  const groupToggle = workHoursGroup.locator('input[data-action="toggle-group"]');
  const disclosure = workHoursGroup.getByRole('button', { name: 'Work Hours', exact: true });

  await expect(workHoursGroup).toHaveCount(1);
  await expect(groupToggle).not.toBeChecked();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(workHoursGroup.locator('button[data-action="add-filter"]')).toBeHidden();

  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

  // The lock is explained in the group, since nothing else on the page says why.
  const offNote = workHoursGroup.getByText('This group is off. Turn it on to make changes.');
  await expect(offNote).toBeVisible();
  await expect(workHoursGroup.locator('button[data-action="edit-group"]')).toBeDisabled();
  await expect(workHoursGroup.getByRole('button', { name: 'New filter' })).toBeDisabled();
  await expect(workHoursGroup.getByRole('button', { name: 'New exception' })).toBeDisabled();

  const filterItem = workHoursGroup.locator('.filter-item').filter({ hasText: 'Focus Block' });
  await expect(filterItem.locator('input[data-action="toggle-filter"]')).toBeDisabled();
  await expect(filterItem.locator('button[data-action="edit-filter"]')).toBeDisabled();

  const whitelistItem = workHoursGroup.locator('.filter-item').filter({ hasText: 'Allow Docs' });
  await expect(whitelistItem.locator('input[data-action="toggle-whitelist"]')).toBeDisabled();
  await expect(whitelistItem.locator('button[data-action="edit-whitelist"]')).toBeDisabled();

  await workHoursGroup.locator('label.group-toggle').click();
  await expect(groupToggle).toBeChecked();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(offNote).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await readStorage(page))?.groups.find((group) => group.id === 'work-hours')?.enabled
    )
    .toBe(true);

  await page.reload();
  await waitForOptionsReady(page);
  const reloadedGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  await expect(reloadedGroup).toHaveCount(1);
  await expect(reloadedGroup.locator('input[data-action="toggle-group"]')).toBeChecked();
  await expect(reloadedGroup.locator('.group-disclosure')).toHaveAttribute('aria-expanded', 'true');
});

test('trims pattern whitespace and rejects a whitespace-only pattern', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);

  // A whitespace-only pattern would be stored as a filter that can never match.
  await page.locator('button[data-action="add-filter"]').first().click();
  const blankModal = page.locator('#filter-modal.active');
  await blankModal.locator('#filter-pattern').fill('   ');
  await blankModal.getByRole('button', { name: 'Save' }).click();

  await expect(blankModal).toBeVisible();
  await expect(blankModal.locator('#filter-error')).toHaveText('Enter a pattern to match.');
  await blankModal.getByRole('button', { name: 'Cancel' }).click();

  // Exceptions share the same validation and report it in their own dialog.
  await page.locator('button[data-action="add-whitelist"]').first().click();
  const exceptionModal = page.locator('#whitelist-modal.active');
  await exceptionModal.getByRole('button', { name: 'Save' }).click();
  await expect(exceptionModal.locator('#whitelist-error')).toHaveText('Enter a pattern to match.');
  await expect(exceptionModal.locator('#whitelist-pattern')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await exceptionModal.getByRole('button', { name: 'Cancel' }).click();

  // Surrounding whitespace on a pasted pattern would otherwise be stored verbatim, leaving a
  // filter that looks active but matches nothing.
  await page.locator('button[data-action="add-filter"]').first().click();
  const pastedModal = page.locator('#filter-modal.active');
  await pastedModal.locator('#filter-pattern').fill('  reddit.com  ');
  await pastedModal.getByRole('button', { name: 'Save' }).click();
  await expect(pastedModal).toBeHidden();

  await expect.poll(async () => (await readStorage(page))?.filters?.length ?? 0).toBe(1);
  const stored = await readStorage(page);
  expect(stored?.filters?.[0]?.pattern).toBe('reddit.com');
});

test('asks before deleting from a dialog, and keeping the item restores the dialog', async ({
  extensionPage,
  page,
}, testInfo) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'keep-filter',
          pattern: 'keep.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
        },
      ],
    })
  );

  // Edit is an icon button, so its tooltip repeats its accessible name.
  const editButton = page.locator('[data-action="edit-filter"][data-filter-id="keep-filter"]');
  await expect(editButton).toHaveAttribute('aria-label', 'Edit filter keep.example.test');
  await expect(editButton).toHaveAttribute('title', 'Edit filter keep.example.test');
  await editButton.click();

  const filterModal = page.locator('#filter-modal.active');
  const deleteButton = filterModal.getByRole('button', { name: 'Delete filter' });
  const saveButton = filterModal.getByRole('button', { name: 'Save' });
  const confirmStrip = filterModal.locator('#filter-delete-confirm');
  await expect(confirmStrip).toBeHidden();

  // The first step only asks; it names the filter by its pattern when it has no name.
  await deleteButton.click();
  await expect(
    filterModal.getByRole('group', { name: /^Delete “keep\.example\.test”/ })
  ).toBeVisible();
  await expect(confirmStrip.locator('#filter-delete-prompt')).toHaveText(
    "Delete “keep.example.test”? This can't be undone."
  );
  await expect(saveButton).toBeHidden();
  const keepButton = confirmStrip.getByRole('button', { name: 'Keep filter' });
  await expect(keepButton).toBeFocused();
  await captureScreenshot(page, testInfo, 'options-delete-confirm.png');

  await keepButton.click();
  await expect(confirmStrip).toBeHidden();
  await expect(saveButton).toBeVisible();
  await expect(deleteButton).toBeFocused();

  // Escape still closes the dialog mid-confirm, and the next open starts from the normal actions.
  await deleteButton.click();
  await expect(keepButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(filterModal).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await editButton.click();
  await expect(confirmStrip).toBeHidden();
  await expect(saveButton).toBeVisible();

  // Hidden controls are skipped by the focus trap, so Tab from Save wraps to the close button.
  await saveButton.focus();
  await page.keyboard.press('Tab');
  await expect(filterModal.getByRole('button', { name: 'Close filter dialog' })).toBeFocused();
  expect((await readStorage(page))?.filters).toHaveLength(1);
});

test('ignores Enter in a field while the delete step asks, until the form is edited', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        { id: 'work-hours', name: 'Work Hours', is24x7: true, schedules: [], enabled: true },
      ],
      filters: [
        {
          id: 'keep-filter',
          pattern: 'keep.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Keep me',
        },
      ],
    })
  );
  const seeded = await readStorage(page);

  await page.locator('[data-action="edit-filter"][data-filter-id="keep-filter"]').click();
  const filterModal = page.locator('#filter-modal.active');
  const confirmStrip = filterModal.locator('#filter-delete-confirm');
  await filterModal.getByRole('button', { name: 'Delete filter' }).click();
  await expect(confirmStrip).toBeVisible();

  // The strip offers only Keep or Delete; the hidden Save button must not take Enter instead.
  await filterModal.locator('#filter-pattern').press('Enter');
  await expect(filterModal).toBeVisible();
  await expect(confirmStrip).toBeVisible();
  expect(await readStorage(page)).toEqual(seeded);

  // Editing a field means the user moved on from deleting: Save returns and Enter saves again.
  await filterModal.locator('#filter-description').fill('Renamed');
  await expect(confirmStrip).toBeHidden();
  await expect(filterModal.getByRole('button', { name: 'Save' })).toBeVisible();
  await filterModal.locator('#filter-description').press('Enter');
  await expect(filterModal).toHaveCount(0);
  await expect.poll(async () => (await readStorage(page))?.filters[0]?.description).toBe('Renamed');

  // The group dialog has its own submit handler, guarded the same way.
  await page.locator('[data-action="edit-group"][data-group-id="work-hours"]').click();
  const groupModal = page.locator('#group-modal.active');
  const groupConfirm = groupModal.locator('#group-delete-confirm');
  await groupModal.getByRole('button', { name: 'Delete group' }).click();
  await expect(groupConfirm).toBeVisible();
  await groupModal.locator('#group-name').press('Enter');
  await expect(groupModal).toBeVisible();
  await expect(groupConfirm).toBeVisible();
});

test('explains a snooze in a notice that resumes filtering', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);
  const notice = page.locator('#snooze-notice');
  const noticeTitle = page.locator('#snooze-notice-title');
  const firstAddFilter = page.locator('button[data-action="add-filter"]').first();
  await expect(notice).toBeHidden();

  // The end is a clock time, which stays correct without a ticking countdown.
  await seedStorage(
    page,
    createStorageData({ snooze: { active: true, until: Date.now() + 60 * 60_000 } })
  );
  await expect(notice).toBeVisible();
  await expect(noticeTitle).toHaveText(/^Filtering is snoozed until \S.*\.$/);
  await expect(noticeTitle).not.toContainText('resume');
  await expect(notice).toContainText(
    'Nothing is blocked. Filters, exceptions and group details are locked.'
  );
  await expect(firstAddFilter).toBeDisabled();

  // The dot sits in the chevron's column, so the notice text starts on the group titles' edge.
  const textLefts = await page.evaluate(() =>
    ['#snooze-notice-title', '#groups-list .group-title'].map(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().left
    )
  );
  expect(textLefts[0]).toBeCloseTo(textLefts[1] ?? NaN, 0);

  await seedStorage(page, createStorageData({ snooze: { active: true } }));
  await expect(noticeTitle).toHaveText('Filtering is snoozed until you resume it.');

  await notice.getByRole('button', { name: 'Resume filtering' }).focus();
  await page.keyboard.press('Enter');
  await expect(notice).toBeHidden();
  await expect.poll(async () => (await readStorage(page))?.snooze).toEqual({ active: false });
  await expect(firstAddFilter).toBeEnabled();
  // The notice took its button with it, so focus moves on to the first group.
  await expect(page.locator('.group-item').first().locator('.group-disclosure')).toBeFocused();
  await expect(page.locator('#status-message')).toHaveText('Filtering resumed.');
});

test('shows a failed resume inside the snooze notice', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(page, createStorageData({ snooze: { active: true } }));
  const notice = page.locator('#snooze-notice');
  const noticeError = notice.locator('#snooze-notice-error');
  const resume = notice.getByRole('button', { name: 'Resume filtering' });
  await expect(notice).toBeVisible();
  await expect(noticeError).toBeHidden();

  await page.evaluate(() => {
    const sync = chrome.storage.sync;
    const originalSet = sync.set;
    Object.assign(window, {
      restoreStorageSet: () => {
        sync.set = originalSet;
      },
    });
    sync.set = (): Promise<void> => Promise.reject(new Error('Extension context invalidated.'));
  });
  await resume.click();

  // The failure is shown next to the button that caused it, as well as announced.
  await expect(noticeError).toBeVisible();
  await expect(noticeError).toHaveText('Failed to resume filtering. Please try again.');
  await expect(page.locator('#status-message')).toHaveText(
    'Failed to resume filtering. Please try again.'
  );
  await expect(notice).toBeVisible();

  // A later resume that works takes the error away with the notice.
  await page.evaluate(() => {
    (window as unknown as { restoreStorageSet: () => void }).restoreStorageSet();
  });
  await resume.click();
  await expect(notice).toBeHidden();
  await expect(noticeError).toBeHidden();
  await expect(noticeError).toBeEmpty();
  await expect(page.locator('#status-message')).toHaveText('Filtering resumed.');
});

test('keeps time-based text current while the page stays open', async ({ extensionPage, page }) => {
  await page.clock.install();
  await gotoOptions(extensionPage, page);
  const now = await page.evaluate(() => Date.now());
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'temporary-filter',
          pattern: 'temporary.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          expiresAt: now + 45 * 60_000,
        },
      ],
      snooze: { active: true, until: now + 30 * 60_000 },
    })
  );

  const temporaryRow = page.locator('.filter-item').filter({ hasText: 'temporary.example.test' });
  const notice = page.locator('#snooze-notice');
  await expect(temporaryRow).toContainText('Temporary · 45m left');
  await expect(notice).toBeVisible();

  // Temporary filters count down in place, and the snooze notice goes once the snooze ends.
  await page.clock.fastForward('01:30');
  await expect(temporaryRow).toContainText('Temporary · 44m left');
  await page.clock.fastForward('30:00');
  await expect(notice).toBeHidden();
  await expect(page.locator('button[data-action="add-filter"]').first()).toBeEnabled();
});

test('explains the selected match mode under the select', async ({ extensionPage, page }) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'exact-filter',
          pattern: 'https://exact.example.test/',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'exact',
        },
      ],
    })
  );

  await page.locator('button[data-action="add-filter"]').first().click();
  const filterModal = page.locator('#filter-modal.active');
  const matchMode = filterModal.getByLabel('Match mode');
  await expect(matchMode).toHaveAccessibleDescription(
    'Blocks any address containing this text, like reddit.com.'
  );
  await matchMode.selectOption('exact');
  await expect(matchMode).toHaveAccessibleDescription('Blocks only this exact address.');
  await matchMode.selectOption('regex');
  await expect(matchMode).toHaveAccessibleDescription('Advanced: tested against the full address.');
  await filterModal.getByRole('button', { name: 'Cancel' }).click();

  // An edited filter's hint follows its stored mode, not the reset form's default.
  await page.locator('[data-action="edit-filter"][data-filter-id="exact-filter"]').click();
  await expect(
    page.locator('#filter-modal.active').getByLabel('Match mode')
  ).toHaveAccessibleDescription('Blocks only this exact address.');
  await page.keyboard.press('Escape');

  await page.locator('button[data-action="add-whitelist"]').first().click();
  await expect(
    page.locator('#whitelist-modal.active').getByLabel('Match mode')
  ).toHaveAccessibleDescription('Allows any address containing this text, like reddit.com.');
});

test('names the group, and a temporary filter’s time left, under the dialog title', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        { id: 'work-hours', name: 'Work Hours', is24x7: true, schedules: [], enabled: true },
      ],
      filters: [
        {
          id: 'work-filter',
          pattern: 'work.example.test',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
        },
        {
          id: 'temporary-filter',
          pattern: 'temporary.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          expiresAt: Date.now() + 45 * 60_000,
        },
      ],
    })
  );

  // The dialog covers the card it was opened from, so it says where the new item goes.
  const workHoursGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  await workHoursGroup.getByRole('button', { name: 'Work Hours', exact: true }).click();
  await workHoursGroup.getByRole('button', { name: 'New filter' }).click();
  await expect(page.getByRole('dialog', { name: 'New filter' })).toHaveAccessibleDescription(
    'In Work Hours'
  );
  await page.keyboard.press('Escape');
  await workHoursGroup.getByRole('button', { name: 'New exception' }).click();
  await expect(page.getByRole('dialog', { name: 'New exception' })).toHaveAccessibleDescription(
    'In Work Hours'
  );
  await page.keyboard.press('Escape');

  // A temporary filter also says when it ends; the next dialog starts without that part.
  await page.locator('[data-action="edit-filter"][data-filter-id="temporary-filter"]').click();
  const subtitle = page.locator('#filter-modal.active #filter-modal-subtitle');
  await expect(subtitle).toHaveText('In 24/7 (Always Active) · Temporary · 45m left');
  await page.keyboard.press('Escape');
  await page.locator('button[data-action="add-filter"]').first().click();
  await expect(subtitle).toHaveText('In 24/7 (Always Active)');
  await page.keyboard.press('Escape');

  // A deep link from the popup opens over whichever card is first, so the subtitle matters most.
  await gotoOptions(extensionPage, page, `${PAGES.OPTIONS}?editFilter=work-filter`);
  await expect(page.getByRole('dialog', { name: 'Edit filter' })).toHaveAccessibleDescription(
    'In Work Hours'
  );
});

test('ends every row with its switch, so all switches share one edge', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        { id: 'work-hours', name: 'Work Hours', is24x7: true, schedules: [], enabled: true },
      ],
      filters: [
        {
          id: 'work-filter',
          pattern: 'work.example.test',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
        },
      ],
      whitelist: [
        {
          id: 'default-exception',
          pattern: 'allowed.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
        },
      ],
    })
  );
  const workHoursGroup = page.locator('.group-item').filter({ hasText: 'Work Hours' });
  await workHoursGroup.getByRole('button', { name: 'Work Hours', exact: true }).click();
  await expect(workHoursGroup.locator('.filter-item')).toBeVisible();

  const layout = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.group-header .actions, .filter-item .actions')];
    const switches = [...document.querySelectorAll('.group-header .toggle, .filter-item .toggle')];
    return {
      switchIsLast: rows.map((actions) => actions.lastElementChild?.matches('.toggle') ?? false),
      switchRightEdges: [
        ...new Set(switches.map((toggle) => toggle.getBoundingClientRect().right)),
      ],
    };
  });
  // Group headers (the default one too, which has no Edit button) and rows end [Edit][switch].
  expect(layout.switchIsLast).toEqual([true, true, true, true]);
  expect(layout.switchRightEdges).toHaveLength(1);
});

test('labels the block page details switch with its description', async ({
  extensionPage,
  page,
}) => {
  await gotoOptions(extensionPage, page);

  const detailsSwitch = page.getByRole('checkbox', { name: 'Show block page details' });
  await expect(detailsSwitch).toHaveAccessibleDescription(
    'Show the address, the matching filter and the buttons without clicking Learn more.'
  );
  // The switch shows its own state, so a change is announced rather than printed under the card,
  // where it would read as part of Backup.
  const status = page.locator('#status-message');
  await detailsSwitch.check();
  await expect.poll(async () => (await readStorage(page))?.expandBlockPageDetails).toBe(true);
  await expect(status).toHaveText('Block page details will be shown.');
  await expect(page.locator('#global-settings-status')).toBeEmpty();
  await detailsSwitch.uncheck();
  await expect.poll(async () => (await readStorage(page))?.expandBlockPageDetails).toBe(false);
  await expect(status).toHaveText('Block page details will be hidden.');
  await expect(page.locator('#global-settings-status')).toBeEmpty();
});

test('reflows the group dialog at 320px without clipping days or times', async ({
  extensionPage,
  page,
}) => {
  // 320 CSS px is a 1280px window at 400% zoom, the width WCAG reflow is tested at.
  await page.setViewportSize({ width: 320, height: 640 });
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'work-hours',
          name: 'Work Hours',
          is24x7: false,
          schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
          enabled: true,
        },
      ],
    })
  );

  await page.locator('[data-action="edit-group"][data-group-id="work-hours"]').click();
  const groupModal = page.locator('#group-modal.active');
  await expect(groupModal.getByLabel('End time for schedule 1')).toHaveValue('17:00');

  const layout = await groupModal.evaluate((modal) => {
    const box = (selector: string): DOMRect =>
      modal.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect();
    return {
      // Room left in each day chip around its label text.
      chipSpare: [...modal.querySelectorAll('#schedules-list .day-checkbox')].map((chip) => {
        const text = document.createRange();
        text.selectNodeContents(chip.lastChild ?? chip);
        return chip.getBoundingClientRect().width - text.getBoundingClientRect().width;
      }),
      timeWidths: [...modal.querySelectorAll('#schedules-list input[type="time"]')].map(
        (input) => input.getBoundingClientRect().width
      ),
      deleteTop: box('#delete-group').top,
      cancel: box('#cancel-group'),
      save: box('button[type="submit"]'),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  // The days wrap rather than squeeze, so every label fits inside its chip.
  expect(Math.min(...layout.chipSpare)).toBeGreaterThan(2);
  // A time input needs about 120px to show its AM/PM; stacked, each gets the full width.
  expect(layout.timeWidths).toHaveLength(2);
  expect(Math.min(...layout.timeWidths)).toBeGreaterThanOrEqual(120);
  // Delete group takes its own row, so Cancel and Save stay paired below it.
  expect(layout.deleteTop).toBeLessThan(layout.cancel.top);
  expect(layout.cancel.top).toBeCloseTo(layout.save.top, 0);
  expect(layout.cancel.width).toBeCloseTo(layout.save.width, 0);
  expect(layout.pageOverflow).toBeLessThanOrEqual(0);
});

test('wraps group meta lines, the Groups header and the snooze notice at 320px', async ({
  extensionPage,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await gotoOptions(extensionPage, page);
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'evenings',
          name: 'Evenings',
          is24x7: false,
          schedules: [
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '22:00' },
            { daysOfWeek: [0, 6], startTime: '10:00', endTime: '23:00' },
          ],
          enabled: true,
        },
        {
          id: 'gym',
          name: 'Gym',
          is24x7: false,
          schedules: [{ daysOfWeek: [1, 3, 5], startTime: '06:00', endTime: '07:30' }],
          enabled: true,
        },
      ],
      snooze: { active: true, until: 9_999_999_999_999 },
    })
  );
  const eveningsMeta = page
    .locator('.group-item')
    .filter({ hasText: 'Evenings' })
    .locator('[data-role="group-meta"]');
  await expect(eveningsMeta).toHaveText(
    'Mon–Fri 18:00–22:00; Sun, Sat 10:00–23:00 · 0 filters · 0 exceptions'
  );

  const meta = await page.locator('#groups-list .group-item').evaluateAll((groups) =>
    groups.map((group) => {
      const controlsLeft =
        group.querySelector('.group-header .actions')?.getBoundingClientRect().left ?? 0;
      const parts = [...group.querySelectorAll('.meta-part')];
      // The first visible character of each rendered line.
      const lineStarts: string[] = [];
      let lineTop = -Infinity;
      const walker = document.createTreeWalker(
        group.querySelector('[data-role="group-meta"]') ?? group,
        NodeFilter.SHOW_TEXT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (let index = 0; index < text.length; index++) {
          if (/\s/.test(text.charAt(index))) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const top = range.getBoundingClientRect().top;
          if (top > lineTop + 1) {
            lineStarts.push(text.charAt(index));
            lineTop = top;
          }
        }
      }
      return {
        overlapsControls: parts.some((part) => part.getBoundingClientRect().right > controlsLeft),
        lineStarts,
      };
    })
  );
  // Each schedule wraps as a unit and stays clear of the Edit button and switch...
  expect(meta.map((group) => group.overlapsControls)).toEqual([false, false, false]);
  expect(meta[1]?.lineStarts.length).toBeGreaterThan(1);
  // ...and a separator stays at the end of its line, never the start of the next.
  expect(meta.flatMap((group) => group.lineStarts).filter((char) => '·,'.includes(char))).toEqual(
    []
  );

  const header = await page.evaluate(() => {
    const box = (selector: string): DOMRect =>
      document.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect();
    return {
      hint: box('.section-hint'),
      newGroup: box('#add-group-btn'),
      header: box('.section-header'),
      noticeText: box('#snooze-notice .notice-text'),
      resume: box('#snooze-notice-resume'),
      switchRight: box('.group-header .toggle').right,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  // New group moves under the hint, still on the trailing edge like New filter.
  expect(header.newGroup.top).toBeGreaterThanOrEqual(header.hint.bottom);
  expect(header.newGroup.right).toBeCloseTo(header.header.right, 0);
  // The notice text keeps the row; Resume wraps under it and ends on the switches' edge.
  expect(header.resume.top).toBeGreaterThanOrEqual(header.noticeText.bottom);
  expect(header.resume.right).toBeCloseTo(header.switchRight, 0);
  expect(header.pageOverflow).toBeLessThanOrEqual(0);
});
