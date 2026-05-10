import type { Page, TestInfo } from '@playwright/test';
import { DEFAULT_GROUP_ID, STORAGE_KEY, type FilterGroup, type StorageData } from '../../src/shared/types';

export const defaultGroup: FilterGroup = {
  id: DEFAULT_GROUP_ID,
  name: '24/7 (Always Active)',
  schedules: [],
  is24x7: true,
};

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

export async function seedExtensionStorage(page: Page, data: StorageData): Promise<void> {
  await page.evaluate(
    async ({ key, storageData }) => chrome.storage.sync.set({ [key]: storageData }),
    {
      key: STORAGE_KEY,
      storageData: data,
    }
  );
}

export async function expandAllGroups(page: Page): Promise<void> {
  await page.locator('details.group-item').evaluateAll((elements) => {
    elements.forEach((element) => {
      (element as HTMLDetailsElement).open = true;
    });
  });
}
