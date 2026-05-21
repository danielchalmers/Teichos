import type { BrowserContext } from '@playwright/test';
import { PAGES } from '../../src/shared/constants';
import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createFilterViaOptions,
  createStorageData,
  defaultGroup,
  expectAllowed,
  expectBlocked,
  expectPopupHidesFilter,
  expectPopupShowsInactiveFilter,
  expectPopupShowsFilter,
  openOptions,
  openPopup,
  readStorage,
  seedStorage,
  toggleFilterViaOptions,
} from './helpers';

async function mockAllowedPage(context: BrowserContext, url: string, label: string): Promise<void> {
  await context.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>${label}</title><main>${label}</main>`,
    });
  });
}

test('options filter lifecycle blocks, restores, and blocks again after re-enable', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://options-lifecycle.example.test/focus';
  await mockAllowedPage(context, targetUrl, 'Options lifecycle allowed');

  const optionsPage = await openOptions(extensionPage, page);
  await createFilterViaOptions(optionsPage, {
    name: 'Options Lifecycle',
    pattern: 'options-lifecycle.example.test',
  });

  const browsingPage = await context.newPage();
  await expectBlocked(browsingPage, targetUrl);
  await captureScreenshot(browsingPage, testInfo, 'options-lifecycle-blocked.png');

  await toggleFilterViaOptions(optionsPage, 'Options Lifecycle', false);
  await expect.poll(() => browsingPage.url()).toBe(targetUrl);
  await expect(browsingPage.getByText('Options lifecycle allowed')).toBeVisible();

  await expectAllowed(browsingPage, targetUrl);

  await toggleFilterViaOptions(optionsPage, 'Options Lifecycle', true);
  await expectBlocked(browsingPage, targetUrl);
});

test('popup toggle changes navigation behavior and direct storage updates refresh popup state', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://popup-toggle.example.test/focus';
  await mockAllowedPage(context, targetUrl, 'Popup toggle allowed');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'popup-toggle-filter',
          pattern: 'popup-toggle.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Popup Toggle',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  const popupPage = await openPopup(extensionPage, page);

  await expectPopupShowsFilter(popupPage, 'Popup Toggle');
  await expectBlocked(browsingPage, targetUrl);

  await popupPage
    .locator('.filter-item')
    .filter({ hasText: 'Popup Toggle' })
    .locator('label.toggle')
    .click();
  await expectPopupShowsInactiveFilter(popupPage, 'Popup Toggle');
  await expectAllowed(browsingPage, targetUrl);

  const data = await readStorage(page);
  expect(data).toBeDefined();
  await seedStorage(page, {
    ...data!,
    filters: data!.filters.map((filter) =>
      filter.id === 'popup-toggle-filter' ? { ...filter, enabled: true } : filter
    ),
    rulesVersion: data!.rulesVersion + 1,
  });

  await expectPopupShowsFilter(popupPage, 'Popup Toggle');
  await expectBlocked(browsingPage, targetUrl);
});

test('whitelisting keeps navigation allowed and hides the matching popup filter for the current url', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://whitelist-lifecycle.example.test/docs';
  await mockAllowedPage(context, targetUrl, 'Whitelist lifecycle allowed');

  const optionsPage = await openOptions(extensionPage, page);
  await createFilterViaOptions(optionsPage, {
    name: 'Whitelist Lifecycle',
    pattern: 'whitelist-lifecycle.example.test',
  });

  const defaultGroupCard = optionsPage
    .locator('details.group-item')
    .filter({ hasText: '24/7 (Always Active)' });
  await defaultGroupCard.getByRole('button', { name: 'New Exception' }).click();

  const whitelistModal = optionsPage.locator('#whitelist-modal.active');
  await expect(whitelistModal).toBeVisible();
  await whitelistModal.getByLabel('Name').fill('Allow Docs');
  await whitelistModal.getByLabel('URL Pattern').fill(targetUrl);
  await whitelistModal.getByRole('button', { name: 'Save' }).click();
  await expect(
    defaultGroupCard.locator('.filter-item').filter({ hasText: 'Allow Docs' })
  ).toHaveCount(1);

  const browsingPage = await context.newPage();
  await expectAllowed(browsingPage, targetUrl);
  await expect(browsingPage.getByText('Whitelist lifecycle allowed')).toBeVisible();

  const popupPage = await openPopup(extensionPage, browsingPage);
  await expectPopupHidesFilter(popupPage, 'Whitelist Lifecycle');

  const whitelistItem = defaultGroupCard.locator('.filter-item').filter({ hasText: 'Allow Docs' });
  await whitelistItem.locator('label.toggle').click();
  await expect(whitelistItem.locator('input[data-action="toggle-whitelist"]')).not.toBeChecked();

  await expectBlocked(browsingPage, targetUrl);
});

test('popup snooze allows navigation until filtering is resumed', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://popup-snooze.example.test/focus';
  await mockAllowedPage(context, targetUrl, 'Popup snooze allowed');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'popup-snooze-filter',
          pattern: 'popup-snooze.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Popup Snooze',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  const popupPage = await openPopup(extensionPage, page);

  await expectPopupShowsFilter(popupPage, 'Popup Snooze');
  await expectBlocked(browsingPage, targetUrl);

  await popupPage.locator('#open-snooze').click();
  await popupPage.getByRole('button', { name: '15m' }).click();
  await expect(popupPage.locator('#snooze-label')).toContainText('Snoozed:');
  await captureScreenshot(popupPage, testInfo, 'popup-snoozed.png');

  await expectAllowed(browsingPage, targetUrl);

  await popupPage.locator('#open-snooze').click();
  await popupPage.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(popupPage.locator('#snooze-label')).toHaveText('Active');

  await expectBlocked(browsingPage, targetUrl);
});
