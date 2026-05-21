import { test, expect } from './fixtures';
import type { AlertCaptureGlobal } from './helpers';
import { PAGES } from '../../src/shared/constants';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
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
  await page.goto(extensionPage(PAGES.OPTIONS));

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  await expect(workHoursGroup).toContainText(
    'Mo-Fr 09:00-17:00, Sa 10:00-12:00 • 0 filters • 0 exceptions'
  );
  await captureScreenshot(page, testInfo, 'options-schedule-hint.png');
});

test('toggles groups by disabling child filters and restores disabled groups collapsed', async ({
  extensionPage,
  page,
}, testInfo) => {
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
          enabled: true,
          schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
        },
      ],
      filters: [
        {
          id: 'default-filter',
          pattern: 'always.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Always On',
        },
        {
          id: 'work-filter',
          pattern: 'work.example.invalid',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Work Block',
        },
      ],
      whitelist: [
        {
          id: 'work-exception',
          pattern: 'work.example.invalid/docs',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Work Docs',
        },
      ],
    })
  );
  await page.goto(extensionPage(PAGES.OPTIONS));

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  const workHoursGroupToggle = workHoursGroup.locator('summary .actions label.toggle').first();
  const defaultGroupCard = page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' });
  const defaultGroupToggle = defaultGroupCard.locator('summary .actions label.toggle').first();
  await expect(workHoursGroup).toHaveAttribute('open', '');

  await workHoursGroupToggle.click();
  await expect
    .poll(
      async () =>
        (await readStorage(page)).groups.find((group) => group.id === 'work-hours')?.enabled
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (await readStorage(page)).filters.find((filter) => filter.id === 'work-filter')?.enabled
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (await readStorage(page)).whitelist.find((entry) => entry.id === 'work-exception')?.enabled
    )
    .toBe(true);

  await defaultGroupToggle.click();
  await expect
    .poll(
      async () =>
        (await readStorage(page)).groups.find((group) => group.id === defaultGroup.id)?.enabled
    )
    .toBe(false);
  await defaultGroupToggle.click();
  await expect
    .poll(
      async () =>
        (await readStorage(page)).groups.find((group) => group.id === defaultGroup.id)?.enabled
    )
    .toBe(true);

  await expect(workHoursGroup).toHaveAttribute('open', '');
  const workFilterToggle = workHoursGroup.locator(
    'input[data-action="toggle-filter"][data-filter-id="work-filter"]'
  );
  const workExceptionToggle = workHoursGroup.locator(
    'input[data-action="toggle-whitelist"][data-whitelist-id="work-exception"]'
  );
  await workHoursGroup
    .locator('.filter-item')
    .filter({ hasText: 'Work Docs' })
    .locator('label.toggle')
    .click();
  await expect(workFilterToggle).not.toBeDisabled();
  await expect(workExceptionToggle).not.toBeDisabled();

  await expect
    .poll(
      async () =>
        (await readStorage(page)).filters.find((filter) => filter.id === 'work-filter')?.enabled
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (await readStorage(page)).whitelist.find((entry) => entry.id === 'work-exception')?.enabled
    )
    .toBe(false);

  await page.reload();

  const reloadedWorkHoursGroup = page
    .locator('details.group-item')
    .filter({ hasText: 'Work Hours' });
  const reloadedDefaultGroup = page
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' });
  await expect(reloadedWorkHoursGroup).not.toHaveAttribute('open', '');
  await expect(reloadedDefaultGroup).toHaveAttribute('open', '');
  await captureScreenshot(page, testInfo, 'options-group-toggle.png');

  await reloadedWorkHoursGroup.locator('summary').click();
  await expect(
    reloadedWorkHoursGroup.locator(
      'input[data-action="toggle-filter"][data-filter-id="work-filter"]'
    )
  ).not.toBeChecked();
  await expect(
    reloadedWorkHoursGroup.locator(
      'input[data-action="toggle-whitelist"][data-whitelist-id="work-exception"]'
    )
  ).not.toBeChecked();

  await reloadedWorkHoursGroup.locator('summary .actions label.toggle').first().click();
  await expect
    .poll(
      async () =>
        (await readStorage(page)).groups.find((group) => group.id === 'work-hours')?.enabled
    )
    .toBe(true);
  await expect(
    reloadedWorkHoursGroup.locator(
      'input[data-action="toggle-filter"][data-filter-id="work-filter"]'
    )
  ).not.toBeChecked();
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
  await expect(workHoursGroup).toHaveAttribute('open', '');

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
  expect((await readStorage(page)).filters).toHaveLength(0);
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
