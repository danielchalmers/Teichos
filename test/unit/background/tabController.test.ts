import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedPageState,
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
    rulesVersion: overrides.rulesVersion ?? 1,
  };
}

function blockedPageUrl(blockId: string): string {
  return `chrome-extension://test-extension-id/${PAGES.BLOCKED}?blockId=${encodeURIComponent(blockId)}`;
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

    const state = await getBlockedTabState(4);
    expect(state).toEqual({
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
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      4,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
    await expect(getTabController().getBlockedPageStateByBlockId(state!.blockId)).resolves.toEqual({
      status: 'blocked',
      state: expect.objectContaining({
        blockId: state!.blockId,
        targetUrl: 'https://blocked.com/focus',
        filter: expect.objectContaining({ id: 'filter-1', pattern: 'blocked.com' }),
        group: expect.objectContaining({ id: DEFAULT_GROUP_ID }),
        effectiveState: {
          filterEnabled: true,
          groupActive: true,
          snoozeActive: false,
        },
      }),
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

    const state = await getBlockedTabState(6);
    expect(state).toEqual({
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
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      6,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
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
      blockId: 'block-5',
      tabId: 5,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 3,
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
    });

    await expect(getTabController().restoreIfAllowed(5, blockedPageUrl('block-5'))).resolves.toBe(
      true
    );

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
    await setBlockedPageState({
      blockId: 'allowed-block',
      tabId: 7,
      targetUrl: 'https://allowed.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 8,
      blockedBy: {
        filterId: 'stale-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'stale-filter',
        pattern: 'stale-blocked.com',
        matchMode: 'contains',
      },
      group: {
        id: DEFAULT_GROUP_ID,
        name: '24/7',
        schedules: [],
        is24x7: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    await getTabController().evaluateNavigation(7, blockedPageUrl('allowed-block'));

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
      blockId: 'stale-block',
      tabId: 10,
      targetUrl: 'https://stale-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 9,
      blockedBy: {
        filterId: 'stale-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState({
      blockId: 'fresh-block',
      tabId: 10,
      targetUrl: 'https://fresh-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 9,
      blockedBy: {
        filterId: 'fresh-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'fresh-filter',
        pattern: 'fresh-blocked.com',
        matchMode: 'contains',
      },
      group: {
        id: DEFAULT_GROUP_ID,
        name: '24/7',
        schedules: [],
        is24x7: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    await expect(
      getTabController().getFreshBlockedTabState(10, blockedPageUrl('fresh-block'))
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

  it('re-evaluates a stale blocked page in place when rules change', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'still-blocking-filter',
            pattern: 'still-blocked.com',
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
      blockId: 'stale-block',
      tabId: 11,
      targetUrl: 'https://still-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 10,
      blockedBy: {
        filterId: 'still-blocking-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState({
      blockId: 'stale-block',
      tabId: 11,
      targetUrl: 'https://still-blocked.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 10,
      blockedBy: {
        filterId: 'still-blocking-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'still-blocking-filter',
        pattern: 'still-blocked.com',
        matchMode: 'contains',
      },
      group: {
        id: DEFAULT_GROUP_ID,
        name: '24/7',
        schedules: [],
        is24x7: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    await expect(
      getTabController().getFreshBlockedPageState(11, blockedPageUrl('stale-block'))
    ).resolves.toEqual({
      status: 'blocked',
      state: expect.objectContaining({
        targetUrl: 'https://still-blocked.com/focus',
        rulesVersion: 11,
        blockedBy: {
          filterId: 'still-blocking-filter',
          groupId: DEFAULT_GROUP_ID,
        },
      }),
    });

    const refreshedState = await getBlockedTabState(11);
    expect(refreshedState?.rulesVersion).toBe(11);
    expect(refreshedState?.blockId).not.toBe('stale-block');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('continues past blocks for the same tab and origin only', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'bypassed-filter',
            pattern: 'bypass.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 12,
      })
    );
    chromeMock.tabs.query.mockImplementation(
      (_query, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([
          {
            id: 12,
            active: true,
            url: blockedPageUrl('bypass-block'),
          } as chrome.tabs.Tab,
        ]);
      }
    );
    await setBlockedTabState({
      blockId: 'bypass-block',
      tabId: 12,
      targetUrl: 'https://bypass.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 12,
      blockedBy: {
        filterId: 'bypassed-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState({
      blockId: 'bypass-block',
      tabId: 12,
      targetUrl: 'https://bypass.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 12,
      blockedBy: {
        filterId: 'bypassed-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'bypassed-filter',
        pattern: 'bypass.com',
        matchMode: 'contains',
      },
      group: {
        id: DEFAULT_GROUP_ID,
        name: '24/7',
        schedules: [],
        is24x7: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    const { getTabController } = await import('../../../src/background/tabController');

    await expect(getTabController().continueFromActiveTab()).resolves.toBe(true);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      12,
      { url: 'https://bypass.com/focus' },
      expect.any(Function)
    );

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(12, 'https://bypass.com/next');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();

    await getTabController().evaluateNavigation(12, 'https://elsewhere.com');
    await getTabController().evaluateNavigation(12, 'https://bypass.com/blocked-again');
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(
      12,
      { url: expect.stringContaining(`/${PAGES.BLOCKED}?blockId=`) },
      expect.any(Function)
    );
  });

  it('re-blocks a bypassed tab when a different filter becomes responsible', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.query.mockImplementation(
      (_query, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([
          {
            id: 14,
            active: true,
            url: blockedPageUrl('bypass-first'),
          } as chrome.tabs.Tab,
        ]);
      }
    );
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'original-filter',
            pattern: 'override.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 13,
      })
    );
    await setBlockedTabState({
      blockId: 'bypass-first',
      tabId: 14,
      targetUrl: 'https://override.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 13,
      blockedBy: {
        filterId: 'original-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState({
      blockId: 'bypass-first',
      tabId: 14,
      targetUrl: 'https://override.com/focus',
      blockedAt: Date.now(),
      rulesVersion: 13,
      blockedBy: {
        filterId: 'original-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'original-filter',
        pattern: 'override.com',
        matchMode: 'contains',
      },
      group: {
        id: DEFAULT_GROUP_ID,
        name: '24/7',
        schedules: [],
        is24x7: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromActiveTab()).resolves.toBe(true);

    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'original-filter',
            pattern: 'override.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: false,
            matchMode: 'contains',
          },
          {
            id: 'replacement-filter',
            pattern: 'override.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 14,
      })
    );

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(14, 'https://override.com/still-blocked');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      14,
      { url: expect.stringContaining(`/${PAGES.BLOCKED}?blockId=`) },
      expect.any(Function)
    );

    const state = await getBlockedTabState(14);
    expect(state?.blockedBy.filterId).toBe('replacement-filter');
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

    await vi.waitFor(async () => {
      const state = await getBlockedTabState(8);
      expect(state?.blockId).toEqual(expect.any(String));
      expect(chromeMock.tabs.update).toHaveBeenCalledWith(
        8,
        { url: blockedPageUrl(state!.blockId) },
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

    const state = await getBlockedTabState(12);
    expect(state?.blockId).toEqual(expect.any(String));
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      12,
      { url: blockedPageUrl(state!.blockId) },
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

    const state = await getBlockedTabState(13);
    expect(state?.blockId).toEqual(expect.any(String));
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      13,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
  });
});
