import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedPageState,
  setBlockedTabState,
} from '../../../src/shared/api/session';
import { getChromeMock } from '../../fixtures/chrome-mocks';
import {
  DEFAULT_GROUP_ID,
  STORAGE_KEY,
  type BlockedPageState,
  type StorageData,
} from '../../../src/shared/types';
import { PAGES } from '../../../src/shared/constants';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [
      { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true },
    ],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    rulesVersion: overrides.rulesVersion ?? 1,
  };
}

function createBlockedPageState(overrides: Partial<BlockedPageState>): BlockedPageState {
  return {
    blockId: overrides.blockId ?? 'block-1',
    tabId: overrides.tabId ?? 1,
    targetUrl: overrides.targetUrl ?? 'https://blocked.com/focus',
    blockedAt: overrides.blockedAt ?? Date.now(),
    rulesVersion: overrides.rulesVersion ?? 1,
    blockedBy: overrides.blockedBy ?? {
      filterId: 'filter-1',
      groupId: DEFAULT_GROUP_ID,
    },
    filter: overrides.filter ?? {
      id: 'filter-1',
      pattern: 'blocked.com',
      matchMode: 'contains',
    },
    group: overrides.group ?? {
      id: DEFAULT_GROUP_ID,
      name: '24/7',
      schedules: [],
      is24x7: true,
    },
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
        url: expect.stringContaining(
          `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=`
        ),
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(4)).resolves.toEqual({
      blockId: expect.any(String),
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
        url: expect.stringContaining(
          `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=`
        ),
      },
      expect.any(Function)
    );
    await expect(getBlockedTabState(6)).resolves.toEqual({
      blockId: expect.any(String),
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

  it('restores blocked tabs when current rules allow them', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      blockId: 'restore-block',
      tabId: 5,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 3,
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState(
      createBlockedPageState({
        blockId: 'restore-block',
        tabId: 5,
        targetUrl: 'https://blocked.com/focus',
      })
    );

    await expect(
      getTabController().restoreIfAllowed(
        5,
        `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=restore-block`
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

  it('reconciles the target from the current blocked page before stale session state', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'stale-filter',
            pattern: 'stale-blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 9,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      blockId: 'stale-block',
      tabId: 7,
      targetUrl: 'https://stale-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 8,
      blockedBy: {
        filterId: 'stale-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState(
      createBlockedPageState({
        blockId: 'stale-block',
        tabId: 7,
        targetUrl: 'https://allowed.com/focus',
      })
    );

    await getTabController().evaluateNavigation(
      7,
      `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=stale-block`
    );

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      7,
      { url: 'https://allowed.com/focus' },
      expect.any(Function)
    );
    await expect(getBlockedTabState(7)).resolves.toBeUndefined();
    await expect(getLastAllowedUrl(7)).resolves.toBe('https://allowed.com/focus');
  });

  it('returns freshly evaluated blocked tab state for the current blocked page target', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'fresh-filter',
            pattern: 'fresh-blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 10,
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      blockId: 'fresh-block',
      tabId: 10,
      targetUrl: 'https://stale-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 9,
      blockedBy: {
        filterId: 'stale-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState(
      createBlockedPageState({
        blockId: 'fresh-block',
        tabId: 10,
        targetUrl: 'https://fresh-blocked.com/focus',
      })
    );

    await expect(
      getTabController().getFreshBlockedTabState(
        10,
        `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=fresh-block`
      )
    ).resolves.toEqual({
      blockId: expect.any(String),
      tabId: 10,
      targetUrl: 'https://fresh-blocked.com/focus',
      blockedAt: expect.any(Number),
      rulesVersion: 10,
      blockedBy: {
        filterId: 'fresh-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
  });

  it('returns blocked-page state by block id without tab sender state', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'matched-tab-filter',
            pattern: 'matched-tab.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 11,
      })
    );
    await setBlockedPageState(
      createBlockedPageState({
        blockId: 'matched-tab-block',
        tabId: 14,
        targetUrl: 'https://matched-tab.com/focus',
        rulesVersion: 11,
        blockedBy: {
          filterId: 'matched-tab-filter',
          groupId: DEFAULT_GROUP_ID,
        },
        filter: {
          id: 'matched-tab-filter',
          pattern: 'matched-tab.com',
          matchMode: 'contains',
        },
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');

    await expect(
      getTabController().getBlockedPageStateByBlockId('matched-tab-block')
    ).resolves.toEqual({
      status: 'blocked',
      state: {
        blockId: 'matched-tab-block',
        tabId: 14,
        targetUrl: 'https://matched-tab.com/focus',
        blockedAt: expect.any(Number),
        rulesVersion: 11,
        blockedBy: {
          filterId: 'matched-tab-filter',
          groupId: DEFAULT_GROUP_ID,
        },
        filter: {
          id: 'matched-tab-filter',
          pattern: 'matched-tab.com',
          matchMode: 'contains',
        },
        group: {
          id: DEFAULT_GROUP_ID,
          name: '24/7',
          schedules: [],
          is24x7: true,
        },
      },
    });
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
          url: expect.stringContaining(
            `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=`
          ),
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
        url: expect.stringContaining(
          `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=`
        ),
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
        url: expect.stringContaining(
          `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=`
        ),
      },
      expect.any(Function)
    );
  });
});
