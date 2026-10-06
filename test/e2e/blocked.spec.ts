import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  expectAllowed,
  expectBlocked,
  mockAllowedPage,
  readStorage,
  seedStorage,
  showBlockPageDetails,
  waitForOptionsReady,
} from './helpers';
import { PAGES } from '../../src/shared/constants';
import { formatUntil } from '../../src/shared/utils/schedules';

const PREVIEW_NOTE = 'Preview with sample data.';

/**
 * Click Go back and wait until the background has answered that there is nothing to restore, so a
 * following URL check cannot pass just because a navigation had not started yet.
 */
async function clickGoBackWithNothingToRestore(page: Page): Promise<void> {
  const noTargetWarning = page.waitForEvent('console', (message) =>
    message.text().includes('No restorable tab target is available')
  );
  await page.getByRole('button', { name: 'Go back' }).click();
  await noTargetWarning;
}

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

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-page-filter',
          pattern: 'blocked.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked Page',
        },
      ],
    })
  );
  await page.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id === 'number') {
      await chrome.storage.session.set({ [`last_allowed_url_${tab.id}`]: url });
    }
  }, allowedUrl);
  await expectBlocked(page, blockedUrl);
  await captureScreenshot(page, testInfo, 'blocked-page.png');

  await showBlockPageDetails(page);
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toBe(allowedUrl);
  await expect(page.getByText('Allowed page')).toBeVisible();
});

test('opens settings from the blocked page', async ({ context, extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.BLOCKED));
  await showBlockPageDetails(page);

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('renders the blocked url and responsible filter from block id state', async ({
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://blocked-state.example.test/focus';

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'blocked-state-filter',
          pattern: 'blocked-state.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Blocked State',
        },
      ],
      rulesVersion: 1,
    })
  );

  await expectBlocked(page, targetUrl);
  await showBlockPageDetails(page);
  await expect(page.getByLabel('Responsible filter')).toContainText('Blocked State');
  await expect(page.getByLabel('Responsible filter')).toContainText('blocked-state.example.test');
});

test('says when a temporary block ends instead of only the group schedule', async ({
  extensionPage,
  page,
}) => {
  const expiresAt = Date.now() + 30 * 60_000;
  // 00:00–23:59 includes its end minute, so this group is active whenever the test runs.
  const allDayGroup = {
    id: 'all-day-group',
    name: 'All day',
    schedules: [
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59' },
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    ],
    is24x7: false,
    enabled: true,
  };

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [defaultGroup, allDayGroup],
      filters: [
        {
          id: 'quick-block-filter',
          pattern: 'quick-block.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          expiresAt,
        },
        {
          id: 'timed-block-filter',
          pattern: 'timed-block.example.test',
          groupId: allDayGroup.id,
          enabled: true,
          matchMode: 'contains',
          expiresAt,
        },
      ],
    })
  );
  // Format the expected end time the way the block page does, in the browser's own locale.
  const locale = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale);
  const until = (): string => formatUntil(expiresAt, Date.now(), locale);

  // A quick block lands in the 24/7 group, where "Always active" alone would read as permanent.
  await expectBlocked(page, 'https://quick-block.example.test/focus');
  await expect(page.getByText(PREVIEW_NOTE)).toBeHidden();
  await showBlockPageDetails(page);
  await expect(page.locator('#responsible-filter-group')).toHaveText(defaultGroup.name);
  await expect(page.locator('#responsible-filter-schedule')).toHaveText(`Temporary · ${until()}`);
  await expect(page.getByRole('button', { name: 'Continue anyway' })).toBeEnabled();

  // In a scheduled group the schedule stays, followed by when the temporary filter ends.
  await page.setViewportSize({ width: 375, height: 812 });
  await expectBlocked(page, 'https://timed-block.example.test/focus');
  await showBlockPageDetails(page);
  const schedule = page.locator('#responsible-filter-schedule');
  await expect(schedule).toHaveText(`Daily 00:00–23:59; Mon–Fri 09:00–17:00 · ${until()}`);
  // On a narrow screen the text wraps between schedules, never inside a range like 09:00–17:00.
  const partLineCounts = await schedule
    .locator('.schedule-part')
    .evaluateAll((parts) =>
      parts.map((part) =>
        Math.round(
          part.getBoundingClientRect().height / parseFloat(getComputedStyle(part).lineHeight)
        )
      )
    );
  expect(partLineCounts).toEqual([1, 1, 1]);
});

test('Continue anyway bypasses the block for that page in that tab only', async ({
  context,
  extensionPage,
  page,
}) => {
  const targetUrl = 'https://bypass.example.test/bypass-focus';
  await mockAllowedPage(page, targetUrl, 'Bypass allowed');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'bypass-filter',
          pattern: 'bypass.example.test/bypass',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Bypass Filter',
        },
      ],
    })
  );

  await expectBlocked(page, targetUrl);
  await showBlockPageDetails(page);
  await expect(page.getByRole('button', { name: 'Continue anyway' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page).toHaveURL(targetUrl);
  await expect(page.getByText('Bypass allowed')).toBeVisible();
  await expectAllowed(page, targetUrl);

  // The bypass is keyed to the exact page and tab the user chose to continue from.
  await expectBlocked(page, 'https://bypass.example.test/bypass-other');
  const otherTab = await context.newPage();
  await otherTab.goto('https://bypass.example.test/');
  await expectBlocked(otherTab, targetUrl);
});

test('renders a sample block in preview mode', async ({ extensionPage, page }) => {
  await page.goto(`${extensionPage(PAGES.BLOCKED)}?preview=1`);
  await expect(page.getByRole('heading', { name: 'Page blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText('https://www.example.com/');
  await showBlockPageDetails(page);
  await expect(page.getByLabel('Responsible filter')).toContainText('Example filter');
  await expect(page.getByLabel('Responsible filter')).toContainText('example.com');
  await expect(page.getByLabel('Responsible filter')).toContainText('Example group');
  await expect(page.locator('#responsible-filter-match')).toHaveText('Contains text');
  await expect(page.locator('#responsible-filter-schedule')).toHaveText('Always active');
  await expect(page.locator('#continue')).toBeVisible();
});

test('hides details and actions behind the Learn more link by default', async ({
  extensionPage,
  page,
}) => {
  await page.goto(`${extensionPage(PAGES.BLOCKED)}?preview=1`);
  const heading = page.getByRole('heading', { name: 'Page blocked' });
  await expect(heading).toBeVisible();
  const headingBox = await heading.boundingBox();
  expect(headingBox).not.toBeNull();

  const learnMore = page.getByRole('button', { name: 'Learn more' });
  await expect(learnMore).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toBeHidden();
  await expect(page.getByLabel('Responsible filter')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Go back' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manage filters' })).toBeHidden();

  await learnMore.click();
  await expect(page.getByLabel('Blocked URL')).toBeVisible();
  await expect(page.getByLabel('Responsible filter')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage filters' })).toBeVisible();
  await expect(learnMore).toBeHidden();
  // The button hides itself, so focus moves to the revealed details instead of the body.
  await expect(page.getByRole('group', { name: 'Block details' })).toBeFocused();
  // The page is anchored to the top, so the reveal only grows downward and the heading stays put.
  expect(await heading.boundingBox()).toEqual(headingBox);
});

test('stacks the actions full width on narrow screens, primary first', async ({
  extensionPage,
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${extensionPage(PAGES.BLOCKED)}?preview=1`);
  await showBlockPageDetails(page);

  const actionsBox = await page.locator('#block-extras .actions').boundingBox();
  expect(actionsBox).not.toBeNull();
  let previousBottom = -1;
  for (const name of ['Go back', 'Continue anyway', 'Manage filters']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box).toMatchObject({ x: actionsBox?.x, width: actionsBox?.width });
    expect(box?.y).toBeGreaterThan(previousBottom);
    previousBottom = (box?.y ?? 0) + (box?.height ?? 0);
  }
});

test('expands details by default when the global setting is enabled', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await waitForOptionsReady(page);
  await page.locator('#global-expand-details').check();
  await expect.poll(async () => (await readStorage(page))?.expandBlockPageDetails).toBe(true);

  await page.goto(`${extensionPage(PAGES.BLOCKED)}?preview=1`);
  await expect(page.getByRole('heading', { name: 'Page blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toBeVisible();
  await expect(page.getByLabel('Responsible filter')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Learn more' })).toBeHidden();
});

test('previews the block page from the options global settings', async ({
  context,
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await waitForOptionsReady(page);

  const previewPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Preview block page' }).click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState('domcontentloaded');

  await expect.poll(() => new URL(previewPage.url()).pathname).toBe(`/${PAGES.BLOCKED}`);
  await expect(previewPage.getByRole('heading', { name: 'Page blocked' })).toBeVisible();
  await expect(previewPage.getByLabel('Blocked URL')).toHaveText('https://www.example.com/');
  await showBlockPageDetails(previewPage);
  await expect(previewPage.locator('#continue')).toBeVisible();
});

test('labels the preview, keeps Continue anyway inactive, and closes it with Go back', async ({
  context,
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await waitForOptionsReady(page);
  // Another tab after Settings is where Chrome would land on its own when the preview closes.
  const otherPage = await context.newPage();
  await otherPage.goto('about:blank');
  await page.bringToFront();

  const previewPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Preview block page' }).click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState('domcontentloaded');

  // The note sits outside the collapsed details, so the sample is labelled before Learn more.
  await expect(previewPage.getByText(PREVIEW_NOTE)).toBeVisible();
  await expect(previewPage.locator('#block-extras')).toBeHidden();

  await showBlockPageDetails(previewPage);
  const continueButton = previewPage.getByRole('button', { name: 'Continue anyway' });
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeDisabled();
  await expect(continueButton).toHaveAccessibleDescription(PREVIEW_NOTE);

  // The preview has no page to return to, so Go back closes it and leaves Settings open.
  const previewClosed = previewPage.waitForEvent('close');
  await previewPage.getByRole('button', { name: 'Go back' }).click();
  await previewClosed;
  expect(context.pages()).toContain(page);
  await expect(page.getByRole('button', { name: 'Preview block page' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => (await chrome.tabs.getCurrent())?.active))
    .toBe(true);
});

test('handles missing or stale block ids and no-op go back safely', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.BLOCKED));
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  const missingBlockPage = page.url();
  await showBlockPageDetails(page);
  // With no block state there is no filter to describe and no page to continue to.
  await expect(page.getByLabel('Responsible filter')).toBeHidden();
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manage filters' })).toBeVisible();
  await clickGoBackWithNothingToRestore(page);
  expect(page.url()).toBe(missingBlockPage);

  await page.goto(
    `${extensionPage(PAGES.BLOCKED)}?url=${encodeURIComponent('https://blocked.example.invalid')}`
  );
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  await page.goto(`${extensionPage(PAGES.BLOCKED)}?blockId=missing-block`);
  await expect(page.getByRole('heading', { name: 'Page blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText('Block details unavailable');

  const staleBlockPage = page.url();
  await showBlockPageDetails(page);
  await clickGoBackWithNothingToRestore(page);
  expect(page.url()).toBe(staleBlockPage);
});
