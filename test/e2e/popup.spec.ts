import { test, expect } from './fixtures';
import type { ClipboardCaptureGlobal } from './helpers';
import { PAGES } from '../../src/shared/constants';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  readStorage,
  seedStorage,
} from './helpers';

const popupFilterData = createStorageData({
  filters: [
    {
      id: 'regular-filter',
      pattern: 'blocked.example.invalid',
      groupId: defaultGroup.id,
      enabled: true,
      matchMode: 'contains',
      description: 'Focus Block',
    },
  ],
});

async function expectTemporaryFilterExpiration(
  page: Parameters<typeof readStorage>[0],
  pattern: string,
  minMs: number,
  maxMs: number
): Promise<void> {
  const data = await readStorage(page);
  const filter = data?.filters.find((entry) => entry.pattern === pattern);

  expect(filter).toBeDefined();
  expect(typeof filter?.expiresAt).toBe('number');

  const remainingMs = (filter?.expiresAt ?? 0) - Date.now();
  expect(remainingMs).toBeGreaterThan(minMs);
  expect(remainingMs).toBeLessThan(maxMs);
}

async function readRequiredStorage(
  page: Parameters<typeof readStorage>[0]
): Promise<NonNullable<Awaited<ReturnType<typeof readStorage>>>> {
  const data = await readStorage(page);
  if (!data) {
    throw new Error('Expected storage data.');
  }
  return data;
}

test('adds and deletes a temporary filter from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.POPUP));

  await page.getByRole('button', { name: 'New temporary filter' }).click();
  await page.getByLabel('Site or pattern').fill('quick.example.invalid');
  await page.getByLabel('Block for').fill('45');
  await page.getByRole('button', { name: 'Start block' }).click();

  const temporaryItem = page.locator('.filter-item').filter({ hasText: 'quick.example.invalid' });
  await expect(temporaryItem).toContainText('Temporary -');

  await temporaryItem.getByRole('button', { name: 'Delete Filter' }).click();
  await expect(page.getByText('No filters configured.')).toBeVisible();
});

test('opens the full filter editor from the popup empty state', async ({
  context,
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.POPUP));

  await expect(page.getByText('No filters configured.')).toBeVisible();

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '+ New Filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.getByRole('heading', { name: 'Add Filter' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('shows the URL pattern when a filter name is blank', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'plain-url-filter',
          pattern: 'github.com/notifications',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: '',
        },
      ],
    })
  );

  await page.goto(extensionPage(PAGES.POPUP));

  await expect(
    page.locator('.filter-item').filter({ hasText: 'github.com/notifications' })
  ).toBeVisible();
});

test('supports copy, toggle, and edit actions for popup filters', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__e2eClipboardText', {
      value: '',
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (globalThis as ClipboardCaptureGlobal).__e2eClipboardText = text;
        },
      },
      configurable: true,
    });
  });

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(page, popupFilterData);
  await page.goto(extensionPage(PAGES.POPUP));

  const regularItem = page.locator('.filter-item').filter({ hasText: 'Focus Block' });

  await expect(regularItem).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-workflow.png');

  await regularItem.getByRole('button', { name: 'Copy URL' }).click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as ClipboardCaptureGlobal).__e2eClipboardText))
    .toBe('blocked.example.invalid');

  const optionsPagePromise = context.waitForEvent('page');
  await regularItem.getByRole('button', { name: 'Edit Filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.getByLabel('Name')).toHaveValue('Focus Block');
  await expect(filterModal.getByLabel('URL Pattern')).toHaveValue('blocked.example.invalid');

  const popupPage = await context.newPage();
  await popupPage.goto(extensionPage(PAGES.POPUP));

  const toggledItem = popupPage.locator('.filter-item').filter({ hasText: 'Focus Block' });
  const toggledInput = toggledItem.locator(
    'input[type="checkbox"][data-filter-id="regular-filter"]'
  );
  await toggledItem.locator('label.toggle').click();
  await expect(toggledItem).toHaveCount(1);
  await expect(toggledInput).not.toBeChecked();
  await expect(popupPage.locator('.inactive-summary')).toHaveCount(0);
  await expect
    .poll(async () => {
      const data = await readRequiredStorage(popupPage);
      return data.filters.find((filter) => filter.id === 'regular-filter')?.enabled;
    })
    .toBe(false);
  await popupPage.close();
});

test('supports quick-add suggestions, validation, duration units, and the full editor link', async ({
  context,
  extensionPage,
  page,
}) => {
  const currentTabUrl = 'https://suggested-current-tab.example.test/focus';
  await page.addInitScript((suggestedUrl) => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = ((queryInfo, callback) => {
      if (queryInfo.active && queryInfo.currentWindow) {
        callback([
          {
            id: 1,
            active: true,
            currentWindow: true,
            url: suggestedUrl,
          } as unknown as chrome.tabs.Tab,
        ]);
        return;
      }

      return originalQuery(queryInfo, callback);
    }) as typeof chrome.tabs.query;
  }, currentTabUrl);

  await page.goto(extensionPage(PAGES.POPUP));
  await page.getByRole('button', { name: 'New temporary filter' }).click();
  const quickAdd = page.locator('#quick-add');

  await expect(quickAdd).toHaveClass(/is-open/);
  await expect(page.getByLabel('Site or pattern')).toHaveValue(currentTabUrl);

  await quickAdd.locator('button[data-duration="2"][data-unit="hours"]').click();
  await expect(page.getByLabel('Block for')).toHaveValue('2');
  await expect(page.getByRole('combobox')).toHaveValue('hours');

  await page.getByLabel('Block for').fill('2');
  await page.evaluate(() => {
    const unitSelect = document.querySelector<HTMLSelectElement>('#quick-add-unit');
    if (unitSelect) {
      unitSelect.value = 'weeks';
    }
  });
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(page.locator('#status-message')).toHaveText('Enter a valid duration.');

  await page.getByRole('combobox').selectOption('hours');
  await page.getByRole('button', { name: 'Start block' }).click();

  const hoursFilter = page.locator('.filter-item').filter({ hasText: currentTabUrl });
  await expect(hoursFilter).toContainText('Temporary - 2h left');
  await expectTemporaryFilterExpiration(page, currentTabUrl, 119 * 60_000, 121 * 60_000);

  await hoursFilter.getByRole('button', { name: 'Delete Filter' }).click();

  await page.getByRole('button', { name: 'New temporary filter' }).click();
  await page.getByLabel('Site or pattern').fill('multi-day.example.invalid');
  await page.getByLabel('Block for').fill('3');
  await page.getByRole('combobox').selectOption('days');
  await page.getByRole('button', { name: 'Start block' }).click();

  const daysFilter = page.locator('.filter-item').filter({ hasText: 'multi-day.example.invalid' });
  await expect(daysFilter).toContainText('Temporary - 3d left');
  await expectTemporaryFilterExpiration(
    page,
    'multi-day.example.invalid',
    3 * 24 * 60 * 60_000 - 60_000,
    3 * 24 * 60 * 60_000 + 60_000
  );

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'New temporary filter' }).click();
  await page.locator('#quick-add button[data-action="open-full-editor"]').click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.locator('#filter-modal.active')).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
});

test('snoozes and resumes filtering from the popup', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'snooze-filter',
          pattern: 'snooze.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Snooze Test',
        },
      ],
    })
  );

  await page.goto(extensionPage(PAGES.POPUP));

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: '15m' }).click();
  await expect(page.locator('#snooze-label')).toContainText('Snoozed:');
  await expect(page.locator('#open-quick-add')).toBeDisabled();

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(page.locator('#open-quick-add')).toBeEnabled();
});

test('hides filters from disabled groups in the popup active list', async ({
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
          id: 'paused-group',
          name: 'Paused Group',
          is24x7: true,
          enabled: false,
          schedules: [],
        },
      ],
      filters: [
        {
          id: 'visible-filter',
          pattern: 'visible.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Visible Filter',
        },
        {
          id: 'hidden-filter',
          pattern: 'hidden.example.invalid',
          groupId: 'paused-group',
          enabled: true,
          matchMode: 'contains',
          description: 'Hidden Filter',
        },
      ],
    })
  );

  await page.goto(extensionPage(PAGES.POPUP));

  await expect(page.locator('.filter-item').filter({ hasText: 'Visible Filter' })).toBeVisible();
  await expect(page.locator('.filter-item').filter({ hasText: 'Hidden Filter' })).toHaveCount(0);
  expect(
    (await readRequiredStorage(page)).filters.find((filter) => filter.id === 'hidden-filter')
      ?.enabled
  ).toBe(true);
});
