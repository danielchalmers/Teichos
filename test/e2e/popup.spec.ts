import { test, expect } from './fixtures';
import type { Locator } from '@playwright/test';
import type { ClipboardCaptureGlobal } from './helpers';
import { PAGES } from '../../src/shared/constants';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  readStorage,
  seedStorage,
  waitForPopupReady,
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

async function gotoPopup(
  extensionPage: (relativePath: string) => string,
  page: Parameters<typeof waitForPopupReady>[0]
): Promise<void> {
  await page.goto(extensionPage(PAGES.POPUP));
  await waitForPopupReady(page);
}

async function openQuickAdd(page: Parameters<typeof waitForPopupReady>[0]): Promise<Locator> {
  await page.locator('#open-quick-add').click();
  const quickAdd = page.locator('#quick-add');
  await expect(quickAdd).toHaveClass(/is-open/);
  return quickAdd;
}

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

test('adds and deletes a temporary filter from the popup', async ({ extensionPage, page }) => {
  await gotoPopup(extensionPage, page);

  await openQuickAdd(page);
  await page.getByLabel('Site or pattern').fill('quick.example.invalid');
  await page.getByLabel('Block for').fill('45');
  await page.getByRole('button', { name: 'Start block' }).click();

  const temporaryItem = page.locator('.filter-item').filter({ hasText: 'quick.example.invalid' });
  await expect(temporaryItem).toContainText('Temporary -');

  await temporaryItem.getByRole('button', { name: 'Delete Filter' }).click();
  await expect(page.getByText('No filters configured.')).toBeVisible();
  // The deleted row's button is gone, so focus moves to what replaced it instead of the body.
  await expect(page.getByRole('button', { name: '+ New Filter' })).toBeFocused();
});

test('opens the full filter editor from the popup empty state', async ({
  context,
  extensionPage,
  page,
}) => {
  await gotoPopup(extensionPage, page);

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

  await gotoPopup(extensionPage, page);

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
  await gotoPopup(extensionPage, page);

  const regularItem = page.locator('.filter-item').filter({ hasText: 'Focus Block' });

  await expect(regularItem).toBeVisible();
  await captureScreenshot(page, testInfo, 'popup-workflow.png');

  await regularItem.getByRole('button', { name: 'Copy URL' }).click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as ClipboardCaptureGlobal).__e2eClipboardText))
    .toBe('blocked.example.invalid');

  const toggle = regularItem.locator('input[type="checkbox"][data-filter-id="regular-filter"]');
  await regularItem.locator('label.toggle').click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const data = await readStorage(page);
      return data?.filters.find((filter) => filter.id === 'regular-filter')?.enabled;
    })
    .toBe(false);

  const optionsPagePromise = context.waitForEvent('page');
  await regularItem.getByRole('button', { name: 'Edit Filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.locator('#filter-description')).toHaveValue('Focus Block');
  await expect(filterModal.locator('#filter-pattern')).toHaveValue('blocked.example.invalid');
});

test('supports quick-add suggestions, validation, duration units, and the full editor link', async ({
  context,
  extensionPage,
  page,
}) => {
  const currentTabUrl = 'https://suggested-current-tab.example.test/focus';
  // The suggestion is the hostname only; a full URL as a "contains" pattern
  // would match just that exact page instead of the site.
  const suggestedPattern = 'suggested-current-tab.example.test';
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

  await gotoPopup(extensionPage, page);
  const quickAdd = await openQuickAdd(page);
  await expect(page.getByLabel('Site or pattern')).toHaveValue(suggestedPattern);
  // The dialog is modal: the popup behind it is inert, so focus cannot land under the backdrop.
  await expect(page.locator('main.content')).toHaveAttribute('inert', '');

  // The form validates inline, so input errors show in the dialog instead of a native bubble.
  const patternInput = page.getByLabel('Site or pattern');
  await patternInput.fill('');
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(quickAdd.locator('#quick-add-error')).toHaveText(
    'Enter a site or pattern to block.'
  );
  await expect(patternInput).toHaveAttribute('aria-invalid', 'true');
  await expect(patternInput).toBeFocused();
  await patternInput.fill(suggestedPattern);
  await expect(quickAdd.locator('#quick-add-error')).toBeHidden();
  await expect(patternInput).not.toHaveAttribute('aria-invalid');

  await page.getByLabel('Block for').fill('0');
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(quickAdd.locator('#quick-add-error')).toHaveText('Enter a valid duration.');
  await expect(page.getByLabel('Block for')).toHaveAttribute('aria-invalid', 'true');

  await quickAdd.locator('button[data-duration="2"][data-unit="hours"]').click();
  await expect(quickAdd.locator('#quick-add-error')).toBeHidden();
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
  await expect(quickAdd.locator('#quick-add-error')).toHaveText('Enter a valid duration.');
  await expect(page.getByLabel('Block for')).toHaveAttribute('aria-invalid', 'true');

  await page.getByRole('combobox').selectOption('hours');
  await expect(quickAdd.locator('#quick-add-error')).toBeHidden();
  await page.getByRole('button', { name: 'Start block' }).click();

  const hoursFilter = page.locator('.filter-item').filter({ hasText: suggestedPattern });
  await expect(hoursFilter).toContainText('Temporary - 2h left');
  await expectTemporaryFilterExpiration(page, suggestedPattern, 119 * 60_000, 121 * 60_000);

  await hoursFilter.getByRole('button', { name: 'Delete Filter' }).click();

  await openQuickAdd(page);
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
  await openQuickAdd(page);
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

  await gotoPopup(extensionPage, page);

  const filterToggle = page.getByRole('checkbox', { name: 'Toggle filter Snooze Test' });

  await page.locator('#open-snooze').click();
  // Opening the dialog moves focus into it.
  await expect(page.getByRole('button', { name: '15m' })).toBeFocused();
  // Escape returns focus to the trigger even after a click on the dialog's text dropped focus to
  // the body, since everything behind the modal dialog is inert.
  await page.locator('#snooze-dialog-title').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#snooze-dialog')).not.toHaveClass(/is-open/);
  await expect(page.locator('#open-snooze')).toBeFocused();

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: '15m' }).click();
  await expect(page.locator('#snooze-label')).toContainText('Snoozed:');
  await expect(page.locator('#open-quick-add')).toBeDisabled();
  // The snoozed list is read-only for keyboard users too, not only behind the pointer overlay.
  await expect(filterToggle).toBeDisabled();

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(page.locator('#open-quick-add')).toBeEnabled();
  await expect(filterToggle).toBeEnabled();
});
