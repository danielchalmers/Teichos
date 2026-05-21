import { test, expect } from './fixtures';
import { createStorageData, defaultGroup, readStorage, seedStorage } from './helpers';
import { PAGES } from '../../src/shared/constants';

test('loads the extension service worker and extension pages', async ({
  extensionId,
  extensionPage,
  page,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  await page.goto(extensionPage(PAGES.OPTIONS));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Group' })).toBeVisible();

  await page.goto(extensionPage(PAGES.POPUP));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByText('No filters configured.')).toBeVisible();
});

test('redirects matching top-level navigations to the blocked page', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
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
    })
  );

  const targetUrl = 'https://blocked.example.invalid/focus';
  await page.goto(targetUrl).catch(() => undefined);

  await expect.poll(() => page.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
});

test('does not redirect matching navigations when the owning group is disabled', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'work-hours',
          name: 'Work Hours',
          is24x7: true,
          enabled: false,
          schedules: [],
        },
      ],
      filters: [
        {
          id: 'work-filter',
          pattern: 'disabled-group.example.invalid',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Disabled Group Block',
        },
      ],
    })
  );

  const targetUrl = 'https://disabled-group.example.invalid/focus';
  await page.goto(targetUrl).catch(() => undefined);

  await expect.poll(() => page.url()).not.toContain(`/${PAGES.BLOCKED}?url=`);
});

test('does not redirect after disabling a group from options', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'work-hours',
          name: 'Work Hours',
          is24x7: true,
          enabled: true,
          schedules: [],
        },
      ],
      filters: [
        {
          id: 'work-filter',
          pattern: 'toggled-group.example.invalid',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Toggled Group Block',
        },
      ],
    })
  );
  await page.goto(extensionPage(PAGES.OPTIONS));

  const workHoursGroup = page.locator('details.group-item').filter({ hasText: 'Work Hours' });
  await workHoursGroup.locator('summary .actions label.toggle').first().click();
  await expect
    .poll(
      async () =>
        (await readStorage(page)).filters.find((filter) => filter.id === 'work-filter')?.enabled
    )
    .toBe(false);

  const targetUrl = 'https://toggled-group.example.invalid/focus';
  await page.goto(targetUrl).catch(() => undefined);

  await expect.poll(() => page.url()).not.toContain(`/${PAGES.BLOCKED}?url=`);
});
