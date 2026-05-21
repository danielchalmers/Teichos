import { PAGES } from '../../src/shared/constants';
import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createFilterViaOptions,
  createGroupViaOptions,
  createStorageData,
  createWhitelistViaOptions,
  mockAllowedPage,
  defaultGroup,
  expectAllowed,
  expectBlocked,
  expectBlockedTabStateCleared,
  expectPopupHidesFilter,
  expectPopupShowsInactiveFilter,
  expectPopupShowsFilter,
  openOptions,
  openPopup,
  readBlockedTabStateForTarget,
  readStorage,
  seedStorage,
  toggleFilterViaOptions,
} from './helpers';

function formatTimeFromMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Generate one active and one inactive schedule window around the current local time
 * so e2e tests can assert both allow and block behavior without mocking time.
 */
function getScheduleWindows(now = new Date()): {
  currentDay: number;
  activeStart: string;
  activeEnd: string;
  inactiveStart: string;
  inactiveEnd: string;
} {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  // Clamp the active and inactive windows near 00:01 and 23:58 so they always stay
  // within a valid day while still landing on opposite sides of the current time.
  const activeStartMinutes = currentMinutes <= 1 ? 0 : currentMinutes - 1;
  const activeEndMinutes = currentMinutes >= 1438 ? 1439 : currentMinutes + 1;

  const [inactiveStartMinutes, inactiveEndMinutes] =
    currentMinutes <= 1436 // 23:56, leaving room for an inactive window at 23:58-23:59.
      ? [currentMinutes + 2, currentMinutes + 3]
      : [currentMinutes - 3, currentMinutes - 2];

  return {
    currentDay: now.getDay(),
    activeStart: formatTimeFromMinutes(activeStartMinutes),
    activeEnd: formatTimeFromMinutes(activeEndMinutes),
    inactiveStart: formatTimeFromMinutes(inactiveStartMinutes),
    inactiveEnd: formatTimeFromMinutes(inactiveEndMinutes),
  };
}

test('options filter lifecycle blocks, restores, and blocks again after re-enable', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://options-lifecycle.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Options lifecycle allowed');

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

test('an already-blocked tab becomes allowed and clears stale state after popup disable', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://blocked-tab-disable.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Blocked tab restored');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-tab-filter',
          pattern: 'blocked-tab-disable.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked Tab Disable',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  await expectBlocked(browsingPage, targetUrl);
  await expect
    .poll(async () => (await readBlockedTabStateForTarget(page, targetUrl))?.targetUrl)
    .toBe(targetUrl);

  const popupPage = await openPopup(extensionPage, browsingPage);
  await popupPage
    .locator('.filter-item')
    .filter({ hasText: 'Blocked Tab Disable' })
    .locator('label.toggle')
    .click();
  await expectPopupShowsInactiveFilter(popupPage, 'Blocked Tab Disable');

  await expect.poll(() => browsingPage.url()).toBe(targetUrl);
  await expect(browsingPage.getByText('Blocked tab restored')).toBeVisible();
  await expectBlockedTabStateCleared(page, targetUrl);
  await captureScreenshot(browsingPage, testInfo, 'blocked-tab-disable-restored.png');

  await expectAllowed(browsingPage, targetUrl);
});

test('popup toggle changes navigation behavior and direct storage updates refresh popup state', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://popup-toggle.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Popup toggle allowed');

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

test('direct storage updates allow navigation after background rules are already primed', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://primed-storage-update.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Primed storage allowed');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'primed-filter',
          pattern: 'primed-storage-update.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Primed Filter',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  await expectBlocked(browsingPage, targetUrl);
  await expect
    .poll(async () => (await readBlockedTabStateForTarget(page, targetUrl))?.blockedBy.filterId)
    .toBe('primed-filter');

  const data = await readStorage(page);
  expect(data).toBeDefined();
  await seedStorage(page, {
    ...data!,
    filters: data!.filters.map((filter) =>
      filter.id === 'primed-filter' ? { ...filter, enabled: false } : filter
    ),
    rulesVersion: data!.rulesVersion + 1,
  });

  await expect.poll(() => browsingPage.url()).toBe(targetUrl);
  await expectAllowed(browsingPage, targetUrl);
  await expectBlockedTabStateCleared(page, targetUrl);
});

test('whitelisting keeps navigation allowed and hides the matching popup filter for the current url', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://whitelist-lifecycle.example.test/docs';
  await mockAllowedPage(page, targetUrl, 'Whitelist lifecycle allowed');

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

test('adding a whitelist from blocked state restores the target and clears stale blocked-tab state', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://blocked-whitelist-lifecycle.example.test/docs';
  await mockAllowedPage(page, targetUrl, 'Blocked whitelist restored');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-whitelist-filter',
          pattern: 'blocked-whitelist-lifecycle.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked Whitelist',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  await expectBlocked(browsingPage, targetUrl);
  await expect
    .poll(async () => (await readBlockedTabStateForTarget(page, targetUrl))?.targetUrl)
    .toBe(targetUrl);

  await createWhitelistViaOptions(page, {
    name: 'Allow Blocked Docs',
    pattern: targetUrl,
  });

  await expect.poll(() => browsingPage.url()).toBe(targetUrl);
  await expect(browsingPage.getByText('Blocked whitelist restored')).toBeVisible();
  await expectBlockedTabStateCleared(page, targetUrl);
  await expectAllowed(browsingPage, targetUrl);
});

test('exact and regex filters block matching real navigations', async ({
  context,
  extensionPage,
  page,
}) => {
  const exactTarget = 'https://exact-block.example.test/focus?mode=now';
  const regexTarget = 'https://regex-block.example.test/articles/42';
  await mockAllowedPage(page, exactTarget, 'Exact target allowed');
  await mockAllowedPage(page, regexTarget, 'Regex target allowed');

  const optionsPage = await openOptions(extensionPage, page);
  await createFilterViaOptions(optionsPage, {
    name: 'Exact Filter',
    pattern: exactTarget,
    matchMode: 'exact',
  });
  await createFilterViaOptions(optionsPage, {
    name: 'Regex Filter',
    pattern: '^https://regex-block\\.example\\.test/articles/\\d+$',
    matchMode: 'regex',
  });

  const exactPage = await context.newPage();
  await expectBlocked(exactPage, exactTarget);

  const regexPage = await context.newPage();
  await expectBlocked(regexPage, regexTarget);
});

test('expired temporary filters do not prevent real navigation from being blocked', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://temporary-expired-regular-active.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Regular filter backstop');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'expired-temporary-filter',
          pattern: 'temporary-expired-regular-active.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Expired Temporary',
          expiresAt: Date.now() - 60_000, // 1 minute ago.
        },
        {
          id: 'active-regular-filter',
          pattern: 'temporary-expired-regular-active.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Regular Backstop',
        },
      ],
    })
  );

  const browsingPage = await context.newPage();
  await expectBlocked(browsingPage, targetUrl);
});

test('expired temporary filters disappear from popup and options ui', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'expired-ui-filter',
          pattern: 'expired-ui.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Expired UI Filter',
          expiresAt: Date.now() - 60_000,
        },
        {
          id: 'regular-ui-filter',
          pattern: 'regular-ui.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Regular UI Filter',
        },
      ],
    })
  );

  const popupPage = await openPopup(extensionPage, page);
  await expectPopupHidesFilter(popupPage, 'Expired UI Filter');
  await expectPopupShowsFilter(popupPage, 'Regular UI Filter');

  const optionsPage = await openOptions(extensionPage, page);
  await expect(
    optionsPage.locator('.filter-item').filter({ hasText: 'Expired UI Filter' })
  ).toHaveCount(0);
  await expect(
    optionsPage.locator('.filter-item').filter({ hasText: 'Regular UI Filter' })
  ).toHaveCount(1);
  await expect
    .poll(async () =>
      (await readStorage(page))?.filters.some((filter) => filter.id === 'expired-ui-filter')
    )
    .toBe(false);
});

test('editing a schedule through options changes navigation from off-schedule allow to on-schedule block', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://schedule-lifecycle.example.test/focus';
  const { currentDay, activeStart, activeEnd, inactiveStart, inactiveEnd } = getScheduleWindows();
  await mockAllowedPage(page, targetUrl, 'Schedule lifecycle allowed');

  const optionsPage = await openOptions(extensionPage, page);
  await createGroupViaOptions(optionsPage, {
    name: 'Schedule Lifecycle',
    schedules: [
      {
        daysOfWeek: [currentDay],
        startTime: inactiveStart,
        endTime: inactiveEnd,
      },
    ],
  });
  await createFilterViaOptions(optionsPage, {
    groupName: 'Schedule Lifecycle',
    name: 'Schedule Lifecycle Filter',
    pattern: 'schedule-lifecycle.example.test',
  });

  const browsingPage = await context.newPage();
  await expectAllowed(browsingPage, targetUrl);
  await expect(browsingPage.getByText('Schedule lifecycle allowed')).toBeVisible();

  const scheduleGroup = optionsPage
    .locator('details.group-item')
    .filter({ hasText: 'Schedule Lifecycle' });
  await scheduleGroup.locator('button[data-action="edit-group"]').click();

  const groupModal = optionsPage.locator('#group-modal.active');
  await expect(groupModal).toBeVisible();
  await groupModal.getByLabel('Start time for schedule 1').fill(activeStart);
  await groupModal.getByLabel('End time for schedule 1').fill(activeEnd);
  await groupModal.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(() => new URL(browsingPage.url()).pathname + new URL(browsingPage.url()).search)
    .toBe(`/${PAGES.BLOCKED}?url=${encodeURIComponent(targetUrl)}`);
  await expect(browsingPage.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await captureScreenshot(browsingPage, testInfo, 'schedule-lifecycle-blocked.png');
});

test('popup snooze allows navigation until filtering is resumed', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const targetUrl = 'https://popup-snooze.example.test/focus';
  await mockAllowedPage(page, targetUrl, 'Popup snooze allowed');

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
