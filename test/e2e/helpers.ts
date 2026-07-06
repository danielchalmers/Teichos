import { expect, type Page, type TestInfo } from '@playwright/test';
import { DAY_NAMES, PAGES } from '../../src/shared/constants';
import type { BlockedTabState, StorageData } from '../../src/shared/types';

export const STORAGE_KEY = 'pageblock_data';
const EXTENSION_NAVIGATION_TIMEOUT_MS = 10_000;

export type ClipboardCaptureGlobal = typeof globalThis & {
  __e2eClipboardText?: string;
};

export type AlertCaptureGlobal = typeof globalThis & {
  __lastAlertMessage?: string;
};

export const defaultGroup = {
  id: 'default-24x7',
  name: '24/7 (Always Active)',
  schedules: [],
  is24x7: true,
} as const satisfies StorageData['groups'][number];

export function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [defaultGroup],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    expandBlockPageDetails: overrides.expandBlockPageDetails ?? false,
    rulesVersion: overrides.rulesVersion ?? 0,
  };
}

export async function seedStorage(page: Page, data: StorageData): Promise<void> {
  await page.evaluate(
    async ({ key, storageData }) => {
      await chrome.storage.sync.set({ [key]: storageData });
    },
    { key: STORAGE_KEY, storageData: data }
  );
}

export async function readStorage(page: Page): Promise<StorageData | undefined> {
  return page.evaluate(async (key) => {
    const result = await chrome.storage.sync.get(key);
    return result[key] as StorageData | undefined;
  }, STORAGE_KEY);
}

export async function expectBlocked(page: Page, targetUrl: string): Promise<void> {
  await page
    .goto(targetUrl, { waitUntil: 'commit', timeout: EXTENSION_NAVIGATION_TIMEOUT_MS })
    .catch(() => undefined);
  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return (
        currentUrl.pathname === `/${PAGES.BLOCKED}` &&
        currentUrl.searchParams.has('blockId') &&
        !currentUrl.searchParams.has('url')
      );
    })
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
}

/**
 * Expand the block page details and action buttons, which are collapsed behind the
 * "Learn more" link unless the global expand-by-default setting is enabled.
 */
export async function showBlockPageDetails(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Learn more' }).click();
  await expect(page.locator('#block-extras')).toBeVisible();
}

export async function expectAllowed(page: Page, targetUrl: string): Promise<void> {
  await page
    .goto(targetUrl, { waitUntil: 'commit', timeout: EXTENSION_NAVIGATION_TIMEOUT_MS })
    .catch(() => undefined);
  await expect.poll(() => page.url()).not.toContain(`/${PAGES.BLOCKED}`);
}

export async function openOptions(
  extensionPage: (relativePath: string) => string,
  page: Page
): Promise<Page> {
  const optionsPage = await page.context().newPage();
  await optionsPage.goto(extensionPage(PAGES.OPTIONS));
  await optionsPage.waitForLoadState('domcontentloaded');
  await waitForOptionsReady(optionsPage);
  return optionsPage;
}

export async function waitForOptionsReady(page: Page): Promise<void> {
  await expect(page.locator('html[data-options-ready="true"]')).toHaveCount(1);
}

export async function openPopup(
  extensionPage: (relativePath: string) => string,
  page: Page
): Promise<Page> {
  const popupPage = await page.context().newPage();
  await popupPage.goto(extensionPage(PAGES.POPUP));
  await page.bringToFront();
  await popupPage.reload();
  await popupPage.waitForLoadState('domcontentloaded');
  await waitForPopupReady(popupPage);
  return popupPage;
}

export async function waitForPopupReady(page: Page): Promise<void> {
  await expect(page.locator('html[data-popup-ready="true"]')).toHaveCount(1);
}

async function openGroupIfNeeded(optionsPage: Page, groupName: string): Promise<void> {
  const group = optionsPage.locator('details.group-item').filter({ hasText: groupName });
  await expect(group).toHaveCount(1);
  if (!(await group.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await group.locator('summary').click();
  }
}

export async function createFilterViaOptions(
  optionsPage: Page,
  filter: {
    groupName?: string;
    name?: string;
    pattern: string;
    matchMode?: 'contains' | 'exact' | 'regex';
    enabled?: boolean;
  }
): Promise<void> {
  const groupName = filter.groupName ?? defaultGroup.name;
  await openGroupIfNeeded(optionsPage, groupName);

  const group = optionsPage.locator('details.group-item').filter({ hasText: groupName });
  await group.getByRole('button', { name: 'New Filter' }).click();

  const modal = optionsPage.locator('#filter-modal.active');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#filter-pattern')).toBeFocused();
  await modal.locator('#filter-description').fill(filter.name ?? '');
  await modal.locator('#filter-pattern').fill(filter.pattern);
  await modal.locator('#filter-match-mode').selectOption(filter.matchMode ?? 'contains');

  const enabled = filter.enabled ?? true;
  const enabledInput = modal.getByLabel('Enabled');
  if (enabled) {
    await enabledInput.check();
  } else {
    await enabledInput.uncheck();
  }

  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(
    group.locator('.filter-item').filter({ hasText: filter.name ?? filter.pattern })
  ).toHaveCount(1);
}

export async function createGroupViaOptions(
  optionsPage: Page,
  group: {
    name: string;
    is24x7?: boolean;
    schedules?: {
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
    }[];
  }
): Promise<void> {
  await optionsPage.getByRole('button', { name: 'New Group' }).click();

  const modal = optionsPage.locator('#group-modal.active');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#group-name')).toBeFocused();
  await modal.locator('#group-name').fill(group.name);

  const alwaysActive = modal.getByLabel('Always Active (24/7)');
  const is24x7 = group.is24x7 ?? false;
  if (is24x7) {
    await alwaysActive.check();
  } else {
    await alwaysActive.uncheck();
    for (const [index, schedule] of (group.schedules ?? []).entries()) {
      await modal.getByRole('button', { name: 'New Schedule' }).click();
      const scheduleItem = modal.locator('#schedules-list .schedule-item').nth(index);
      const dayCheckboxes = scheduleItem.locator('label.day-checkbox input');
      const selectedDays = new Set(schedule.daysOfWeek);
      for (const dayIndex of schedule.daysOfWeek) {
        const checkbox = dayCheckboxes.nth(dayIndex);
        if (!(await checkbox.isChecked())) {
          await checkbox.click();
        }
      }
      for (const dayIndex of DAY_NAMES.keys()) {
        if (selectedDays.has(dayIndex)) {
          continue;
        }
        const checkbox = dayCheckboxes.nth(dayIndex);
        if (await checkbox.isChecked()) {
          await checkbox.click();
        }
      }

      await modal
        .locator(`input[aria-label="Start time for schedule ${index + 1}"]`)
        .fill(schedule.startTime);
      await modal
        .locator(`input[aria-label="End time for schedule ${index + 1}"]`)
        .fill(schedule.endTime);
    }
  }

  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(
    optionsPage.locator('details.group-item').filter({ hasText: group.name })
  ).toHaveCount(1);
}

export async function createWhitelistViaOptions(
  optionsPage: Page,
  whitelist: {
    groupName?: string;
    name?: string;
    pattern: string;
    matchMode?: 'contains' | 'exact' | 'regex';
    enabled?: boolean;
  }
): Promise<void> {
  const groupName = whitelist.groupName ?? defaultGroup.name;
  await openGroupIfNeeded(optionsPage, groupName);

  const group = optionsPage.locator('details.group-item').filter({ hasText: groupName });
  await group.getByRole('button', { name: 'New Exception' }).click();

  const modal = optionsPage.locator('#whitelist-modal.active');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#whitelist-pattern')).toBeFocused();
  await modal.locator('#whitelist-description').fill(whitelist.name ?? '');
  await modal.locator('#whitelist-pattern').fill(whitelist.pattern);
  await modal.locator('#whitelist-match-mode').selectOption(whitelist.matchMode ?? 'contains');

  const enabled = whitelist.enabled ?? true;
  const enabledInput = modal.getByLabel('Enabled');
  if (enabled) {
    await enabledInput.check();
  } else {
    await enabledInput.uncheck();
  }

  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(
    group.locator('.filter-item').filter({ hasText: whitelist.name ?? whitelist.pattern })
  ).toHaveCount(1);
}

export async function toggleFilterViaOptions(
  optionsPage: Page,
  filterLabel: string,
  enabled: boolean
): Promise<void> {
  const filterItem = optionsPage.locator('.filter-item').filter({ hasText: filterLabel });
  const toggle = filterItem.locator('input[data-action="toggle-filter"]');
  await expect(toggle).toHaveCount(1);

  const isChecked = await toggle.isChecked();
  if (isChecked !== enabled) {
    await filterItem.locator('label.toggle').click();
  }

  if (enabled) {
    await expect(toggle).toBeChecked();
  } else {
    await expect(toggle).not.toBeChecked();
  }
}

export async function expectPopupShowsFilter(page: Page, filterLabel: string): Promise<void> {
  await expect(page.locator('.filter-item').filter({ hasText: filterLabel })).toHaveCount(1);
}

export async function expectPopupHidesFilter(page: Page, filterLabel: string): Promise<void> {
  await expect(page.locator('.filter-item').filter({ hasText: filterLabel })).toHaveCount(0);
}

export async function expectPopupShowsInactiveFilter(
  page: Page,
  filterLabel: string
): Promise<void> {
  const filterItems = page.locator('.filter-item').filter({ hasText: filterLabel });
  await expect(filterItems).toHaveCount(1);
  await expect(filterItems.locator('input[type="checkbox"]')).not.toBeChecked();
}

export async function mockAllowedPage(page: Page, url: string, label: string): Promise<void> {
  await page.context().route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>${label}</title><main>${label}</main>`,
    });
  });
}

export async function readBlockedTabStateForTarget(
  page: Page,
  targetUrl: string
): Promise<BlockedTabState | undefined> {
  return page.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }

      const key = `blocked_tab_state_${tab.id}`;
      const result = await chrome.storage.session.get(key);
      const state = result[key] as BlockedTabState | undefined;
      if (state?.targetUrl === url) {
        return state;
      }
    }

    return undefined;
  }, targetUrl);
}

export async function expectBlockedTabStateCleared(page: Page, targetUrl: string): Promise<void> {
  await expect.poll(() => readBlockedTabStateForTarget(page, targetUrl)).toBeUndefined();
}

export async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  fileName: string
): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(fileName),
    fullPage: true,
  });
}
