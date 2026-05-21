import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  readStorage,
  seedStorage,
} from './helpers';
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

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage Filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('restores a blocked tab after disabling the owning group from options', async ({
  context,
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
          enabled: true,
          is24x7: true,
          schedules: [],
        },
      ],
      filters: [
        {
          id: 'focus-filter',
          pattern: 'blocked.example.invalid',
          groupId: 'work-hours',
          enabled: true,
          matchMode: 'contains',
          description: 'Focus Block',
        },
      ],
    })
  );

  const targetUrl = 'https://blocked.example.invalid/focus';
  await context.route(targetUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Restored</title><main>Restored page</main>',
    });
  });

  const blockedTab = await context.newPage();
  await blockedTab.goto(targetUrl).catch(() => undefined);
  await expect.poll(() => blockedTab.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(blockedTab.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionPage(PAGES.OPTIONS));
  const workHoursGroup = optionsPage
    .locator('details.group-item')
    .filter({ hasText: 'Work Hours' });
  await workHoursGroup.locator('input[data-action="toggle-group"]').evaluate((input) => {
    const toggle = input as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect
    .poll(
      async () =>
        (await readStorage(optionsPage)).groups.find((group) => group.id === 'work-hours')?.enabled
    )
    .toBe(false);
  await expect.poll(() => blockedTab.url()).toBe(targetUrl);
  await expect(blockedTab.getByText('Restored page')).toBeVisible();
});
