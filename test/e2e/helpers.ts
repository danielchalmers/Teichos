import type { Page, TestInfo } from '@playwright/test';
import type { StorageData } from '../../src/shared/types';

export const STORAGE_KEY = 'pageblock_data';

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

export async function readStorage(page: Page): Promise<StorageData> {
  return page.evaluate(async (key) => {
    const result = await chrome.storage.sync.get(key);
    return result[key] as StorageData;
  }, STORAGE_KEY);
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
