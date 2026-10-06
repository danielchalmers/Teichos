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
  waitForOptionsReady,
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

/** Report `url` as the active tab, as when the popup opens over a page. */
async function stubActiveTabUrl(
  page: Parameters<typeof waitForPopupReady>[0],
  url: string
): Promise<void> {
  await page.addInitScript((activeUrl) => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = ((queryInfo, callback) => {
      if (queryInfo.active && queryInfo.currentWindow) {
        callback([
          {
            id: 1,
            active: true,
            currentWindow: true,
            url: activeUrl,
          } as unknown as chrome.tabs.Tab,
        ]);
        return;
      }

      return originalQuery(queryInfo, callback);
    }) as typeof chrome.tabs.query;
  }, url);
}

/** Make settings writes fail, as at the sync write quota, until the returned function runs. */
async function failSettingsWrites(
  page: Parameters<typeof waitForPopupReady>[0]
): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const sync = chrome.storage.sync as typeof chrome.storage.sync & {
      e2eOriginalSet?: typeof chrome.storage.sync.set;
    };
    sync.e2eOriginalSet = sync.set.bind(sync);
    sync.set = (() => Promise.reject(new Error('write failed'))) as typeof sync.set;
  });
  return async () => {
    await page.evaluate(() => {
      const sync = chrome.storage.sync as typeof chrome.storage.sync & {
        e2eOriginalSet?: typeof chrome.storage.sync.set;
      };
      if (sync.e2eOriginalSet) {
        sync.set = sync.e2eOriginalSet;
      }
    });
  };
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
  await expect(temporaryItem).toContainText('Temporary · 45m left');
  // Results use the feature's name, as the dialog and its Start block button do.
  await expect(page.locator('#status-message')).toHaveText('Temporary block started for 45m.');

  await temporaryItem.getByRole('button', { name: 'Delete filter' }).click();
  await expect(page.getByText('No filters yet')).toBeVisible();
  await expect(page.locator('#status-message')).toHaveText('Temporary block deleted.');
  // The deleted row's button is gone, so focus moves to what replaced it instead of the body.
  await expect(page.getByRole('button', { name: 'New filter' })).toBeFocused();
});

test('opens the full filter editor from the popup empty state', async ({
  context,
  extensionPage,
  page,
}) => {
  await gotoPopup(extensionPage, page);

  const emptyState = page.getByRole('listitem').filter({ hasText: 'No filters yet' });
  // The title and its one button say what to do, with no paragraph to read.
  await expect(emptyState.locator('.empty-state-text')).toHaveCount(0);

  const optionsPagePromise = context.waitForEvent('page');
  await emptyState.getByRole('button', { name: 'New filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.getByRole('heading', { name: 'New filter' })).toBeVisible();
  await expect.poll(() => new URL(optionsPage.url()).pathname).toBe(`/${PAGES.OPTIONS}`);
  // Like every other route to Settings, the popup closes itself once Settings is open.
  await expect.poll(() => page.isClosed()).toBe(true);
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

  await regularItem.getByRole('button', { name: 'Copy pattern' }).click();
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
  await regularItem.getByRole('button', { name: 'Edit filter' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  const filterModal = optionsPage.locator('#filter-modal.active');
  await expect(filterModal).toBeVisible();
  await expect(filterModal.locator('#filter-description')).toHaveValue('Focus Block');
  await expect(filterModal.locator('#filter-pattern')).toHaveValue('blocked.example.invalid');
});

test('supports quick-add suggestions, validation, duration units, and the settings link', async ({
  context,
  extensionPage,
  page,
}) => {
  // The suggestion is the hostname only; a full URL as a "contains" pattern
  // would match just that exact page instead of the site.
  const suggestedPattern = 'suggested-current-tab.example.test';
  await stubActiveTabUrl(page, 'https://suggested-current-tab.example.test/focus');

  await gotoPopup(extensionPage, page);
  const quickAdd = await openQuickAdd(page);
  await expect(page.getByLabel('Site or pattern')).toHaveValue(suggestedPattern);
  // The close button is named after the dialog, not an internal name.
  await expect(
    quickAdd.getByRole('button', { name: 'Close temporary block dialog' })
  ).toHaveAttribute('title', 'Close temporary block dialog');
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
  await expect(hoursFilter).toContainText('Temporary · 2h left');
  await expectTemporaryFilterExpiration(page, suggestedPattern, 119 * 60_000, 121 * 60_000);

  await hoursFilter.getByRole('button', { name: 'Delete filter' }).click();

  await openQuickAdd(page);
  await page.getByLabel('Site or pattern').fill('multi-day.example.invalid');
  await page.getByLabel('Block for').fill('3');
  await page.getByRole('combobox').selectOption('days');
  await page.getByRole('button', { name: 'Start block' }).click();

  const daysFilter = page.locator('.filter-item').filter({ hasText: 'multi-day.example.invalid' });
  await expect(daysFilter).toContainText('Temporary · 3d left');
  await expectTemporaryFilterExpiration(
    page,
    'multi-day.example.invalid',
    3 * 24 * 60 * 60_000 - 60_000,
    3 * 24 * 60 * 60_000 + 60_000
  );

  const optionsPagePromise = context.waitForEvent('page');
  await openQuickAdd(page);
  await quickAdd.getByRole('button', { name: 'Open settings' }).click();
  const optionsPage = await optionsPagePromise;
  await waitForOptionsReady(optionsPage);

  // "Need a schedule or exception?": both start from a group, so Settings opens with no dialog.
  await expect(optionsPage.locator('.modal.active')).toHaveCount(0);
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
  const snoozeDialog = page.getByRole('dialog', { name: 'Snooze filtering' });
  const quickAddButton = page.getByRole('button', { name: 'New temporary block' });

  // The header holds the snooze status beside New temporary block, an icon button whose tooltip
  // repeats its name until snoozing disables it.
  await expect(page.locator('header #open-quick-add')).toHaveCount(1);
  await expect(quickAddButton).toHaveAttribute('title', 'New temporary block');
  await page.locator('#open-snooze').click();
  // With no snooze to describe, the dialog's title says it all.
  await expect(snoozeDialog).toHaveAccessibleDescription('');
  await expect(page.locator('#snooze-dialog-subtitle')).toBeHidden();
  await expect(snoozeDialog.getByRole('button', { name: 'Close snooze dialog' })).toHaveAttribute(
    'title',
    'Close snooze dialog'
  );
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
  // The chip counts down, so its tooltip says when the snooze ends instead.
  await expect(page.locator('#open-snooze')).toHaveAttribute('title', /^Snoozed until \S.*\.$/);
  await expect(quickAddButton).toBeDisabled();
  await expect(quickAddButton).toHaveAttribute(
    'title',
    'Temporary blocks are unavailable while snoozed'
  );
  // The status chip is the only notice: the dimmed, disabled rows show the list is read-only,
  // for keyboard users too, not only behind the pointer.
  await expect(filterToggle).toBeDisabled();
  await expect(page.locator('.notice')).toHaveCount(0);

  // While snoozed the dialog leads with resuming, and its description says when the snooze ends,
  // as a clock time rather than a ticking countdown.
  await page.locator('#open-snooze').click();
  await expect(page.getByRole('button', { name: 'Resume filtering' })).toBeFocused();
  await expect(snoozeDialog).toHaveAccessibleDescription(/^Snoozed until \S.*\.$/);
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(quickAddButton).toBeEnabled();
  await expect(quickAddButton).toHaveAttribute('title', 'New temporary block');
  await expect(filterToggle).toBeEnabled();
});

test('snoozes for a custom duration when Enter is pressed in its field', async ({
  extensionPage,
  page,
}) => {
  await gotoPopup(extensionPage, page);

  await page.locator('#open-snooze').click();
  const customDuration = page.getByLabel('Custom snooze duration');
  // An invalid duration is reported in the dialog, as from the Snooze button.
  await customDuration.fill('0');
  await customDuration.press('Enter');
  await expect(page.locator('#snooze-error')).toHaveText('Enter a valid snooze duration.');
  await expect(customDuration).toHaveAttribute('aria-invalid', 'true');

  await customDuration.fill('45');
  await customDuration.press('Enter');
  await expect(page.locator('#snooze-dialog')).not.toHaveClass(/is-open/);
  await expect(page.locator('#open-snooze')).toBeFocused();
  await expect(page.locator('#snooze-label')).toHaveText(/^Snoozed: 4[45]m$/);
  const snooze = (await readStorage(page))?.snooze;
  expect(snooze?.active).toBe(true);
  const remainingMs = (snooze?.until ?? 0) - Date.now();
  expect(remainingMs).toBeGreaterThan(44 * 60_000);
  expect(remainingMs).toBeLessThanOrEqual(45 * 60_000);
});

test('describes a snooze with no end time', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  // Older or imported settings can hold a snooze with no end.
  await seedStorage(page, createStorageData({ snooze: { active: true } }));
  await gotoPopup(extensionPage, page);

  const trigger = page.locator('#open-snooze');
  await expect(page.locator('#snooze-label')).toHaveText('Snoozed');
  await expect(trigger).toHaveAccessibleName('Snoozed, snooze filtering');
  await expect(trigger).toHaveAttribute('title', 'Snoozed until you resume it.');
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Snooze filtering' })).toHaveAccessibleDescription(
    'Snoozed until you resume it.'
  );
});

test('shows a failed resume in the snooze dialog, which stays open', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({ snooze: { active: true, until: Date.now() + 30 * 60_000 } })
  );
  await gotoPopup(extensionPage, page);

  const snoozeDialog = page.locator('#snooze-dialog');
  const snoozeError = page.locator('#snooze-error');
  const resumeButton = page.getByRole('button', { name: 'Resume filtering' });
  const restoreWrites = await failSettingsWrites(page);
  await page.locator('#open-snooze').click();
  await resumeButton.click();
  await expect(snoozeError).toHaveText('Failed to resume filtering. Please try again.');
  await expect(page.locator('#status-message')).toHaveText(
    'Failed to resume filtering. Please try again.'
  );
  await expect(snoozeDialog).toHaveClass(/is-open/);
  await expect(page.locator('#snooze-label')).toHaveText(/^Snoozed: /);

  // The error belongs to that attempt, so the dialog reopens without it.
  await page.keyboard.press('Escape');
  await page.locator('#open-snooze').click();
  await expect(snoozeError).toBeHidden();

  // A retry that works closes the dialog.
  await restoreWrites();
  await resumeButton.click();
  await expect(snoozeDialog).not.toHaveClass(/is-open/);
  await expect(snoozeError).toBeHidden();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
});

test('closes either dialog with a click outside it', async ({ extensionPage, page }) => {
  await gotoPopup(extensionPage, page);

  // The backdrop covers the popup, so its bottom corner is outside either dialog.
  const clickOutside = (): Promise<void> => page.mouse.click(8, 590);
  const quickAdd = await openQuickAdd(page);
  await clickOutside();
  await expect(quickAdd).not.toHaveClass(/is-open/);
  await expect(page.locator('#open-quick-add')).toBeFocused();

  await page.locator('#open-snooze').click();
  const snoozeDialog = page.locator('#snooze-dialog');
  await expect(snoozeDialog).toHaveClass(/is-open/);
  await clickOutside();
  await expect(snoozeDialog).not.toHaveClass(/is-open/);
  await expect(page.locator('#open-snooze')).toBeFocused();

  // A text selection dragged out of a field ends outside the dialog, but is not a click outside.
  await openQuickAdd(page);
  const patternBox = await page.getByLabel('Site or pattern').boundingBox();
  await page.mouse.move((patternBox?.x ?? 0) + 8, (patternBox?.y ?? 0) + 8);
  await page.mouse.down();
  await page.mouse.move(8, 590);
  await page.mouse.up();
  await expect(quickAdd).toHaveClass(/is-open/);
});

test('shows a failed temporary block in its dialog', async ({ extensionPage, page }) => {
  await gotoPopup(extensionPage, page);

  const quickAdd = await openQuickAdd(page);
  await page.getByLabel('Site or pattern').fill('quick.example.invalid');
  await failSettingsWrites(page);
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(quickAdd.locator('#quick-add-error')).toHaveText(
    "Couldn't start the temporary block. Try again."
  );
  await expect(quickAdd).toHaveClass(/is-open/);
});

test('locks the list while snoozed and unlocks it on resume', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'locked-filter',
          pattern: 'locked.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Locked Test',
        },
      ],
      snooze: { active: true, until: Date.now() + 30 * 60_000 },
    })
  );

  await gotoPopup(extensionPage, page);

  const filterList = page.getByRole('list', { name: 'Active filters' });
  await expect(page.getByRole('checkbox', { name: 'Toggle filter Locked Test' })).toBeDisabled();
  // With every row control disabled, the list itself takes focus so it can still be scrolled.
  await expect(filterList).toHaveAttribute('tabindex', '0');

  await page.locator('#open-snooze').click();
  await page.getByRole('button', { name: 'Resume filtering' }).click();
  await expect(page.locator('#snooze-label')).toHaveText('Active');
  await expect(page.locator('#open-snooze')).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Toggle filter Locked Test' })).toBeEnabled();
  await expect(filterList).not.toHaveAttribute('tabindex');
  await expect.poll(async () => (await readStorage(page))?.snooze.active).toBe(false);
});

test('lines temporary row actions up with regular rows and summarizes hidden filters', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        { id: 'off-group', name: 'Off Group', schedules: [], is24x7: true, enabled: false },
      ],
      filters: [
        {
          id: 'regular-row',
          pattern: 'regular.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Regular Row',
        },
        {
          id: 'temporary-row',
          pattern: 'temporary.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Temporary Row',
          expiresAt: Date.now() + 45 * 60_000,
        },
        {
          id: 'off-row',
          pattern: 'off.example.invalid',
          groupId: 'off-group',
          enabled: true,
          matchMode: 'contains',
          description: 'Off Row',
        },
      ],
    })
  );

  await gotoPopup(extensionPage, page);

  const regularRow = page.locator('.filter-item').filter({ hasText: 'Regular Row' });
  const temporaryRow = page.locator('.filter-item').filter({ hasText: 'Temporary Row' });
  const leftEdge = async (locator: Locator): Promise<number | undefined> =>
    (await locator.boundingBox())?.x;

  // A temporary row has no switch, but its copy and delete buttons sit under copy and edit.
  await expect(temporaryRow.locator('label.toggle')).toHaveCount(0);
  expect(await leftEdge(temporaryRow.getByRole('button', { name: 'Copy pattern' }))).toBe(
    await leftEdge(regularRow.getByRole('button', { name: 'Copy pattern' }))
  );
  expect(await leftEdge(temporaryRow.getByRole('button', { name: 'Delete filter' }))).toBe(
    await leftEdge(regularRow.getByRole('button', { name: 'Edit filter' }))
  );

  await expect(page.locator('.filter-item').filter({ hasText: 'Off Row' })).toHaveCount(0);
  await expect(page.locator('.inactive-summary')).toHaveText('1 inactive filter hidden');
});

test('explains a list with no active filters and opens settings from it', async ({
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
        { id: 'off-group', name: 'Bedtime', schedules: [], is24x7: true, enabled: false },
      ],
      filters: [
        {
          id: 'off-row',
          pattern: 'off.example.invalid',
          groupId: 'off-group',
          enabled: true,
          matchMode: 'contains',
          description: 'Off Row',
        },
      ],
    })
  );
  await gotoPopup(extensionPage, page);

  const filterList = page.getByRole('list', { name: 'Active filters' });
  const inactiveState = filterList
    .getByRole('listitem')
    .filter({ hasText: 'No filters apply here right now' });
  await expect(inactiveState).toContainText("1 filter is in a group that's turned off.");
  // The count line is for under rows; with none, the state above says it all.
  await expect(page.locator('.inactive-summary')).toHaveCount(0);
  // With nothing to scroll, the list itself is no tab stop; the button is.
  await expect(filterList).not.toHaveAttribute('tabindex');

  const optionsPagePromise = context.waitForEvent('page');
  await inactiveState.getByRole('button', { name: 'Open settings' }).click();
  const optionsPage = await optionsPagePromise;
  await waitForOptionsReady(optionsPage);
  await expect(optionsPage.locator('.modal.active')).toHaveCount(0);
  await expect.poll(() => page.isClosed()).toBe(true);
});

test('names each reason no filter is active on the current page', async ({
  extensionPage,
  page,
}) => {
  const today = new Date().getDay();
  await stubActiveTabUrl(page, 'https://reading.example.test/article');
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        {
          id: 'later-group',
          name: 'Later',
          // Three days from now, so it cannot be running today.
          schedules: [{ daysOfWeek: [(today + 3) % 7], startTime: '09:00', endTime: '17:00' }],
          is24x7: false,
          enabled: true,
        },
        {
          id: 'unscheduled-group',
          name: 'Unscheduled',
          schedules: [],
          is24x7: false,
          enabled: true,
        },
        { id: 'off-group', name: 'Off', schedules: [], is24x7: true, enabled: false },
      ],
      filters: [
        {
          id: 'later-a',
          pattern: 'later-a.example.invalid',
          groupId: 'later-group',
          enabled: true,
          matchMode: 'contains',
        },
        {
          id: 'later-b',
          pattern: 'later-b.example.invalid',
          groupId: 'later-group',
          enabled: true,
          matchMode: 'contains',
        },
        {
          id: 'unscheduled',
          pattern: 'unscheduled.example.invalid',
          groupId: 'unscheduled-group',
          enabled: true,
          matchMode: 'contains',
        },
        {
          id: 'off',
          pattern: 'off.example.invalid',
          groupId: 'off-group',
          enabled: true,
          matchMode: 'contains',
        },
        {
          id: 'excepted',
          pattern: 'example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
        },
      ],
      whitelist: [
        {
          id: 'reading',
          pattern: 'reading.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
        },
      ],
    })
  );
  await gotoPopup(extensionPage, page);

  // One reason per line. The excepted filter still blocks other pages, so nothing says that
  // nothing is blocked: the title is about this page only.
  await expect(page.locator('.empty-state-title')).toHaveText('No filters apply here right now');
  await expect(page.locator('.empty-state-text')).toHaveJSProperty(
    'textContent',
    [
      "2 filters are outside their group's schedule.",
      '1 filter is in a group with no schedule.',
      "1 filter is in a group that's turned off.",
      '1 filter has an exception for this page.',
    ].join('\n')
  );
});

test('keeps settings reachable from the inactive list while snoozed', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      groups: [
        defaultGroup,
        { id: 'off-group', name: 'Off', schedules: [], is24x7: true, enabled: false },
      ],
      filters: [
        {
          id: 'off-row',
          pattern: 'off.example.invalid',
          groupId: 'off-group',
          enabled: true,
          matchMode: 'contains',
        },
      ],
      snooze: { active: true, until: Date.now() + 30 * 60_000 },
    })
  );
  await gotoPopup(extensionPage, page);

  // Snoozing locks filter changes; opening settings changes nothing, so it stays available.
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeEnabled();
  await expect(page.getByRole('list', { name: 'Active filters' })).not.toHaveAttribute('tabindex');
});
