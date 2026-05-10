import type { FilterGroup, StorageData } from '../../src/shared/types';
import { test, expect } from './fixtures';
import { captureScreenshot, defaultGroup, expandAllGroups, seedExtensionStorage } from './helpers';

const WORK_HOURS_GROUP: FilterGroup = {
  id: 'work-hours',
  name: 'Work Hours',
  schedules: [
    {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
    },
  ],
  is24x7: false,
};

const LONG_BLOCKED_URL =
  'https://blocked.example.invalid/really/long/path/that/keeps/going/for/review/screenshots/and/layout/checks?source=playwright&campaign=visual-state&note=wrap-this-url-nicely-in-the-blocked-page-artifact';

function createVisualStateData(now: number): StorageData {
  return {
    groups: [defaultGroup, WORK_HOURS_GROUP],
    filters: [
      {
        id: 'focus-social',
        pattern: 'social.example.invalid',
        groupId: defaultGroup.id,
        enabled: true,
        matchMode: 'contains',
        description: 'Focus Social',
      },
      {
        id: 'work-news',
        pattern: 'news.example.invalid',
        groupId: WORK_HOURS_GROUP.id,
        enabled: false,
        matchMode: 'contains',
        description: 'Work Hours News',
      },
      {
        id: 'deep-work-sprint',
        pattern: 'video.example.invalid',
        groupId: defaultGroup.id,
        enabled: true,
        matchMode: 'contains',
        description: 'Deep Work Sprint',
        expiresAt: now + 30 * 60 * 1000,
      },
    ],
    whitelist: [
      {
        id: 'docs-exception',
        pattern: 'social.example.invalid/docs',
        groupId: defaultGroup.id,
        enabled: true,
        matchMode: 'contains',
        description: 'Docs Exception',
      },
    ],
    snooze: { active: false },
  };
}

test('captures seeded visual-state screenshots', async ({ extensionPage, page }, testInfo) => {
  const now = Date.now();
  const visualStateData = createVisualStateData(now);

  await page.goto(extensionPage('options/index.html'));
  await seedExtensionStorage(page, visualStateData);
  await page.reload();

  await expect(page.getByText('Work Hours')).toBeVisible();
  await expect(page.getByText('Focus Social')).toBeVisible();
  await expect(page.getByText('Docs Exception')).toBeVisible();
  await expandAllGroups(page);
  await captureScreenshot(page, testInfo, 'options-configured-filters.png');

  await page.goto(extensionPage('popup/index.html'));
  await expect(page.getByText('Focus Social')).toBeVisible();
  await expect(page.getByText('Deep Work Sprint')).toBeVisible();
  await expect(page.getByText('1 more inactive filter')).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-configured.png');

  await seedExtensionStorage(page, {
    ...visualStateData,
    snooze: { active: true, until: now + 60 * 60 * 1000 },
  });
  await page.reload();

  await expect(page.getByText('Deep Work Sprint')).toBeVisible();
  await expect(page.getByText(/Snoozed:/)).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-snoozed.png');

  await page.goto(`${extensionPage('blocked/index.html')}?url=${encodeURIComponent(LONG_BLOCKED_URL)}`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(LONG_BLOCKED_URL);
  await captureScreenshot(page, testInfo, 'blocked-page-long-url.png');
});
