import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWarningBypasses,
  getWarningTabState,
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedTabState,
} from '../../../src/shared/api/session';
import { getChromeMock } from '../../fixtures/chrome-mocks';
import { DEFAULT_GROUP_ID, STORAGE_KEY, type StorageData } from '../../../src/shared/types';
import { PAGES } from '../../../src/shared/constants';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [
      { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true },
    ],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    settings: overrides.settings ?? { defaultBlockType: 'block-page' },
    rulesVersion: overrides.rulesVersion ?? 1,
  };
}

describe('TabController', () => {
  beforeEach(() => {
    vi.resetModules();
    getChromeMock().storage.sync._data.set(STORAGE_KEY, createStorageData());
  });

  it('blocks matching navigations and stores blocked tab state', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 7,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(4, 'https://blocked.com/focus');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      4,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}`,
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(4)).resolves.toEqual({
      tabId: 4,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: expect.any(Number),
      rulesVersion: 7,
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('redirects warning matches to the interstitial and stores warning tab state', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        settings: { defaultBlockType: 'warning' },
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'default',
          },
        ],
        rulesVersion: 9,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(14, 'https://warning.com/focus');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      14,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/focus')}&mode=warning`,
      },
      expect.any(Function)
    );
    await expect(getWarningTabState(14)).resolves.toEqual({
      tabId: 14,
      targetUrl: 'https://warning.com/focus',
      warningAt: expect.any(Number),
      rulesVersion: 9,
      bypassKey: 'https://warning.com',
      warnedBy: {
        filterId: 'warning-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('uses a matching regular filter when an earlier temporary match is already expired', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'expired-temporary-filter',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            expiresAt: Date.now() - 60_000,
          },
          {
            id: 'regular-filter',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 8,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(6, 'https://blocked.com/focus');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      6,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}`,
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(6)).resolves.toEqual({
      tabId: 6,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: expect.any(Number),
      rulesVersion: 8,
      blockedBy: {
        filterId: 'regular-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('stores the last allowed url for allowed navigations', async () => {
    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(9, 'https://allowed.com');

    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com');
  });

  it('continues warning tabs by storing a tab-session bypass and restoring the target url', async () => {
    const chromeMock = getChromeMock();
    const warningUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/focus')}&mode=warning`;
    chromeMock.tabs.query.mockImplementation(
      (query: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        if (query.active && query.currentWindow) {
          callback?.([{ id: 15, url: warningUrl, active: true } as chrome.tabs.Tab]);
          return;
        }
        callback?.([]);
      }
    );
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        settings: { defaultBlockType: 'warning' },
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 10,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');

    await expect(getTabController().continueWarningFromActiveTab()).resolves.toEqual({
      continued: true,
    });
    await expect(getWarningBypasses(15)).resolves.toEqual([
      { filterId: 'warning-filter', urlKey: 'https://warning.com' },
    ]);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      15,
      { url: 'https://warning.com/focus' },
      expect.any(Function)
    );
  });

  it('applies warning bypasses only to the same filter and origin key', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        settings: { defaultBlockType: 'warning' },
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 11,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(16, 'https://warning.com/first');

    const warningUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/first')}&mode=warning`;
    chromeMock.tabs.query.mockImplementation(
      (query: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        if (query.active && query.currentWindow) {
          callback?.([{ id: 16, url: warningUrl, active: true } as chrome.tabs.Tab]);
          return;
        }
        callback?.([]);
      }
    );
    await getTabController().continueWarningFromActiveTab();

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(16, 'https://warning.com/second');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    await expect(getLastAllowedUrl(16)).resolves.toBe('https://warning.com/second');

    await getTabController().evaluateNavigation(16, 'https://other.warning.com/second');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      16,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://other.warning.com/second')}&mode=warning`,
      },
      expect.any(Function)
    );
  });

  it('lets hard blocks override an existing warning bypass', async () => {
    const chromeMock = getChromeMock();
    const warningUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/focus')}&mode=warning`;
    chromeMock.tabs.query.mockImplementation(
      (query: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        if (query.active && query.currentWindow) {
          callback?.([{ id: 17, url: warningUrl, active: true } as chrome.tabs.Tab]);
          return;
        }
        callback?.([]);
      }
    );
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        settings: { defaultBlockType: 'warning' },
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 12,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().continueWarningFromActiveTab();

    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        settings: { defaultBlockType: 'warning' },
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'warning',
          },
          {
            id: 'block-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'block-page',
          },
        ],
        rulesVersion: 13,
      })
    );

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(17, 'https://warning.com/after-bypass');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      17,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/after-bypass')}`,
      },
      expect.any(Function)
    );
  });

  it('restores blocked tabs when current rules allow them', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      tabId: 5,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 3,
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
    });

    await expect(
      getTabController().restoreIfAllowed(
        5,
        `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}`
      )
    ).resolves.toBe(true);

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      5,
      { url: 'https://blocked.com/focus' },
      expect.any(Function)
    );
    await expect(getBlockedTabState(5)).resolves.toBeUndefined();
    await expect(getLastAllowedUrl(5)).resolves.toBe('https://blocked.com/focus');
  });

  it('reconciles open tabs after storage changes', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.query.mockImplementation(
      (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([{ id: 8, url: 'https://blocked.com/focus' } as chrome.tabs.Tab]);
      }
    );

    const { getTabController } = await import('../../../src/background/tabController');
    getTabController().register();

    const onChanged = chromeMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 4,
      })
    );

    onChanged?.({ [STORAGE_KEY]: { newValue: true } }, 'sync');

    await vi.waitFor(() => {
      expect(chromeMock.tabs.update).toHaveBeenCalledWith(
        8,
        {
          url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}`,
        },
        expect.any(Function)
      );
    });
  });

  it('invalidates cached rules immediately when sync storage changes', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    getTabController().register();

    await expect(getTabController().getUrlDecision('https://blocked.com')).resolves.toEqual({
      action: 'allow',
      reason: 'no-match',
    });

    const onChanged = chromeMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    const updatedData = createStorageData({
      filters: [
        {
          id: 'filter-2',
          pattern: 'blocked.com',
          groupId: DEFAULT_GROUP_ID,
          enabled: true,
          matchMode: 'contains',
        },
      ],
      rulesVersion: 2,
    });
    chromeMock.storage.sync._data.set(STORAGE_KEY, updatedData);

    onChanged?.({ [STORAGE_KEY]: { newValue: updatedData } }, 'sync');

    await getTabController().evaluateNavigation(12, 'https://blocked.com');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      12,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com')}`,
      },
      expect.any(Function)
    );
  });

  it('reloads current rules for navigation decisions even if a storage event is missed', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');

    await expect(getTabController().getUrlDecision('https://blocked.com')).resolves.toEqual({
      action: 'allow',
      reason: 'no-match',
    });

    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'filter-3',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 3,
      })
    );
    // Intentionally update the backing mock storage without invoking the
    // storage listener to simulate a missed chrome.storage.onChanged event.

    await getTabController().evaluateNavigation(13, 'https://blocked.com');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      13,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com')}`,
      },
      expect.any(Function)
    );
  });
});
