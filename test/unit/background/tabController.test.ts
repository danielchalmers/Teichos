import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
    blockType: overrides.blockType ?? 'block',
    snooze: overrides.snooze ?? { active: false },
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
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}&mode=block`,
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(4)).resolves.toEqual({
      tabId: 4,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
      blockedAt: expect.any(Number),
      rulesVersion: 7,
      blockedBy: {
        filterId: 'filter-1',
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
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}&mode=block`,
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(6)).resolves.toEqual({
      tabId: 6,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
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

  it('restores blocked tabs when current rules allow them', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      tabId: 5,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
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
          url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/focus')}&mode=block`,
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
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com')}&mode=block`,
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
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com')}&mode=block`,
      },
      expect.any(Function)
    );
  });

  it('redirects warning matches to the interstitial and records warning state', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 9,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(10, 'https://warning.com/focus');

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      10,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/focus')}&mode=warning`,
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(10)).resolves.toEqual({
      tabId: 10,
      targetUrl: 'https://warning.com/focus',
      blockType: 'warning',
      blockedAt: expect.any(Number),
      rulesVersion: 9,
      blockedBy: {
        filterId: 'warning-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('updates an already-blocked interstitial when rules change from block to warning', async () => {
    const chromeMock = getChromeMock();
    const targetUrl = 'https://warning.com/focus';
    const hardBlockedPageUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent(targetUrl)}&mode=block`;
    const warningBlockedPageUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent(targetUrl)}&mode=warning`;

    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        blockType: 'warning',
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
    await setBlockedTabState({
      tabId: 14,
      targetUrl,
      blockType: 'block',
      blockedAt: Date.now(),
      rulesVersion: 10,
      blockedBy: {
        filterId: 'warning-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });

    await getTabController().evaluateNavigation(14, hardBlockedPageUrl);

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      14,
      { url: warningBlockedPageUrl },
      expect.any(Function)
    );
    await expect(getBlockedTabState(14)).resolves.toMatchObject({
      tabId: 14,
      targetUrl,
      blockType: 'warning',
      rulesVersion: 11,
      blockedBy: {
        filterId: 'warning-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('continues past a warning in the active tab and scopes the bypass to the warning filter origin', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
          {
            id: 'hard-filter',
            pattern: 'warning.com/hard',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'block',
          },
        ],
        rulesVersion: 10,
      })
    );
    chromeMock.tabs.query.mockImplementation(
      (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([
          {
            id: 11,
            active: true,
            url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/focus')}&mode=warning`,
          } as chrome.tabs.Tab,
        ]);
      }
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      tabId: 11,
      targetUrl: 'https://warning.com/focus',
      blockType: 'warning',
      blockedAt: Date.now(),
      rulesVersion: 10,
      blockedBy: {
        filterId: 'warning-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });

    await expect(getTabController().continueWarningFromActiveTab()).resolves.toBe(true);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      11,
      { url: 'https://warning.com/focus' },
      expect.any(Function)
    );

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(11, 'https://warning.com/another-path');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();

    await getTabController().evaluateNavigation(11, 'https://warning.com/hard');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      11,
      {
        url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://warning.com/hard')}&mode=block`,
      },
      expect.any(Function)
    );
  });
});
