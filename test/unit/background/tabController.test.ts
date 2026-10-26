import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBlockedTabState,
  getBypassState,
  getLastAllowedUrl,
  setBlockedPageState,
  setBlockedTabState,
  setBypassState,
  setLastAllowedUrl,
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

const newsFilter = {
  id: 'news-filter',
  pattern: 'news.com',
  groupId: DEFAULT_GROUP_ID,
  enabled: true,
  matchMode: 'contains',
} as const;

const shortLinkFilter = { ...newsFilter, id: 'short-link-filter', pattern: 'short.link' } as const;

/** Record a block of `targetUrl` in `tabId` the way the controller does when it redirects. */
async function seedBlock(
  tabId: number,
  blockId: string,
  targetUrl: string,
  filter: typeof newsFilter | typeof shortLinkFilter = newsFilter
): Promise<void> {
  const blockedBy = { filterId: filter.id, groupId: DEFAULT_GROUP_ID };
  await setBlockedTabState({ blockId, tabId, targetUrl, blockedAt: Date.now(), blockedBy });
  await setBlockedPageState({
    blockId,
    tabId,
    targetUrl,
    blockedAt: Date.now(),
    blockedBy,
    filter: { id: filter.id, pattern: filter.pattern, matchMode: filter.matchMode },
    group: { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true },
    effectiveState: { filterEnabled: true, groupActive: true, snoozeActive: false },
  });
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

  it('reuses the existing block when the same tab re-navigates to the same target', async () => {
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
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(4, 'https://blocked.com/focus');
    const firstState = await getBlockedTabState(4);

    // The browser back button re-commits the blocked target while the tab is still blocked.
    await getTabController().evaluateNavigation(4, 'https://blocked.com/focus');

    const secondState = await getBlockedTabState(4);
    expect(secondState?.blockId).toBe(firstState?.blockId);
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(
      4,
      { url: blockedPageUrl(firstState!.blockId) },
      expect.any(Function)
    );
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

  it('records when the temporary filter behind a block expires in its page snapshot', async () => {
    const expiresAt = Date.now() + 30 * 60_000;
    getChromeMock().storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'temporary-filter',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            expiresAt,
          },
          { ...newsFilter, id: 'regular-filter' },
        ],
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(6, 'https://blocked.com/focus');
    await getTabController().evaluateNavigation(7, 'https://news.com/today');

    const temporaryBlock = await getBlockedTabState(6);
    await expect(
      getTabController().getBlockedPageStateByBlockId(temporaryBlock!.blockId)
    ).resolves.toMatchObject({
      status: 'blocked',
      state: { filter: { id: 'temporary-filter', pattern: 'blocked.com', expiresAt } },
    });

    // A regular filter's snapshot has no expiry, so the block page shows only the group schedule.
    const regularBlock = await getBlockedTabState(7);
    await expect(
      getTabController().getBlockedPageStateByBlockId(regularBlock!.blockId)
    ).resolves.toEqual({
      status: 'blocked',
      state: expect.objectContaining({
        filter: { id: 'regular-filter', pattern: 'news.com', matchMode: 'contains' },
      }),
    });
  });

  it('stores the last allowed url for allowed navigations', async () => {
    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(9, 'https://allowed.com');

    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com');
  });

  it('records the page to return to only once the navigation commits', async () => {
    const { getTabController } = await import('../../../src/background/tabController');
    // An allowed start may still redirect somewhere blocked, or never commit (a download).
    await getTabController().evaluateNavigation(9, 'https://allowed.com', { beforeCommit: true });
    await expect(getLastAllowedUrl(9)).resolves.toBeUndefined();

    await getTabController().evaluateNavigation(9, 'https://allowed.com');
    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com');
  });

  it('blocks where a server redirect lands and keeps the page before it to return to', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await setLastAllowedUrl(9, 'https://allowed.com/article');

    const { getTabController } = await import('../../../src/background/tabController');
    // The shortener itself is allowed; only its destination is blocked.
    await getTabController().evaluateNavigation(9, 'https://short.link/abc', {
      beforeCommit: true,
    });
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();

    await getTabController().evaluateNavigation(9, 'https://news.com/story');
    const state = await getBlockedTabState(9);
    expect(state?.targetUrl).toBe('https://news.com/story');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      9,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
    // Reopening the shortener would only redirect to the block again.
    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com/article');
  });

  it('keeps the page before a continued shortener when it redirects somewhere else blocked', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({ filters: [shortLinkFilter, newsFilter] })
    );
    await setLastAllowedUrl(9, 'https://allowed.com/article');
    await seedBlock(9, 'block-short', 'https://short.link/abc', shortLinkFilter);

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('block-short')).resolves.toBe(true);
    await getTabController().evaluateNavigation(9, 'https://short.link/abc', {
      beforeCommit: true,
    });
    await getTabController().evaluateNavigation(9, 'https://news.com/story');

    await expect(getBlockedTabState(9)).resolves.toMatchObject({
      targetUrl: 'https://news.com/story',
    });
    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com/article');
  });

  it('redirects blocked tabs to the target when current rules allow them', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      blockId: 'block-5',
      tabId: 5,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: Date.now(),
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
    });

    await getTabController().evaluateNavigation(5, blockedPageUrl('block-5'));

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

  it('returns the stored snapshot without re-evaluating it against current rules', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'replacement-filter',
            pattern: 'still-blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await setBlockedTabState({
      blockId: 'original-block',
      tabId: 10,
      targetUrl: 'https://still-blocked.com/focus',
      blockedAt: Date.now(),
      blockedBy: {
        filterId: 'original-filter',
        groupId: DEFAULT_GROUP_ID,
      },
    });
    await setBlockedPageState({
      blockId: 'original-block',
      tabId: 10,
      targetUrl: 'https://still-blocked.com/focus',
      blockedAt: Date.now(),
      blockedBy: {
        filterId: 'original-filter',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'original-filter',
        pattern: 'original-pattern.com',
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

    // The snapshot still names the filter responsible at the time of the block, even though a
    // different filter would be responsible under the current rules.
    await expect(
      getTabController().getBlockedPageStateForTab(10, blockedPageUrl('original-block'))
    ).resolves.toEqual({
      status: 'blocked',
      state: expect.objectContaining({
        blockId: 'original-block',
        targetUrl: 'https://still-blocked.com/focus',
        blockedBy: {
          filterId: 'original-filter',
          groupId: DEFAULT_GROUP_ID,
        },
        filter: expect.objectContaining({ id: 'original-filter' }),
      }),
    });
  });

  it('leaves a still-blocked page untouched when rules change', async () => {
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

    await getTabController().evaluateNavigation(11, blockedPageUrl('stale-block'));

    const state = await getBlockedTabState(11);
    expect(state?.blockId).toBe('stale-block');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('continues past a filter for the rest of the tab session', async () => {
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

    // Other pages the same filter blocks stay allowed in this tab, even after leaving for an
    // allowed page and coming back.
    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(12, 'https://bypass.com/focus#section');
    await getTabController().evaluateNavigation(12, 'https://bypass.com/next');
    await getTabController().evaluateNavigation(12, 'https://allowed.com/');
    await getTabController().evaluateNavigation(12, 'https://bypass.com/later');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    await expect(getBypassState(12)).resolves.toEqual({ filterIds: ['bypassed-filter'] });
  });

  it('continues by block id in the blocked tab only, without unlocking other tabs', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await seedBlock(40, 'block-40', 'https://news.com/story');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('block-40')).resolves.toBe(true);

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      40,
      { url: 'https://news.com/story' },
      expect.any(Function)
    );
    await expect(getBypassState(40)).resolves.toEqual({ filterIds: [newsFilter.id] });

    await getTabController().evaluateNavigation(41, 'https://news.com/story');
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(
      41,
      { url: expect.stringContaining(`/${PAGES.BLOCKED}?blockId=`) },
      expect.any(Function)
    );
  });

  it('keeps earlier bypasses when the tab continues past another filter', async () => {
    const chromeMock = getChromeMock();
    const sportsFilter = { ...newsFilter, id: 'sports-filter', pattern: 'sports.com' };
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({ filters: [newsFilter, sportsFilter] })
    );
    await seedBlock(50, 'block-50', 'https://news.com/story');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('block-50')).resolves.toBe(true);

    // A different filter still blocks the tab until the user continues past it too.
    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(50, 'https://sports.com/scores');
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(
      50,
      { url: expect.stringContaining(`/${PAGES.BLOCKED}?blockId=`) },
      expect.any(Function)
    );
    const sportsBlock = await getBlockedTabState(50);
    await expect(getTabController().continueFromBlockedPage(sportsBlock!.blockId)).resolves.toBe(
      true
    );
    await expect(getBypassState(50)).resolves.toEqual({
      filterIds: [newsFilter.id, sportsFilter.id],
    });

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(50, 'https://news.com/other');
    await getTabController().evaluateNavigation(50, 'https://sports.com/other');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('still blocks with a filter the tab never continued past when a bypassed one also matches', async () => {
    const chromeMock = getChromeMock();
    const gamesFilter = { ...newsFilter, id: 'games-filter', pattern: 'news.com/games' };
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({ filters: [newsFilter, gamesFilter] })
    );
    await seedBlock(51, 'block-51', 'https://news.com/story');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('block-51')).resolves.toBe(true);
    await expect(getBypassState(51)).resolves.toEqual({ filterIds: [newsFilter.id] });

    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(51, 'https://news.com/games/chess');
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(
      51,
      { url: expect.stringContaining(`/${PAGES.BLOCKED}?blockId=`) },
      expect.any(Function)
    );
    const state = await getBlockedTabState(51);
    expect(state?.blockedBy.filterId).toBe(gamesFilter.id);
  });

  it('bypasses only the filter the block page names, even when Continue repeats', async () => {
    const chromeMock = getChromeMock();
    const gamesFilter = { ...newsFilter, id: 'games-filter', pattern: 'news.com/games' };
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({ filters: [newsFilter, gamesFilter] })
    );
    await seedBlock(52, 'block-52', 'https://news.com/games/chess');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('block-52')).resolves.toBe(true);
    // The block page's snapshot outlives the click, so a second Continue from it must not hand
    // the games filter, which now wins for this page, a bypass the user never chose.
    await expect(getTabController().continueFromBlockedPage('block-52')).resolves.toBe(true);
    await expect(getBypassState(52)).resolves.toEqual({ filterIds: [newsFilter.id] });

    await getTabController().evaluateNavigation(52, 'https://news.com/games/chess');
    const state = await getBlockedTabState(52);
    expect(state?.blockedBy.filterId).toBe(gamesFilter.id);
  });

  it('names every filter that blocks a page and continues past them all at once', async () => {
    const chromeMock = getChromeMock();
    const storyFilter = {
      ...newsFilter,
      id: 'story-filter',
      pattern: 'https://news.com/story',
      matchMode: 'exact',
      description: 'That one story',
    } as const;
    const sportsFilter = { ...newsFilter, id: 'sports-filter', pattern: 'news.com/sports' };
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({ filters: [newsFilter, storyFilter, sportsFilter] })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(60, 'https://news.com/story');

    const state = await getBlockedTabState(60);
    expect(state?.blockedBy).toEqual({
      filterId: newsFilter.id,
      groupId: DEFAULT_GROUP_ID,
      otherFilterIds: [storyFilter.id],
    });
    await expect(getTabController().getBlockedPageStateByBlockId(state!.blockId)).resolves.toEqual({
      status: 'blocked',
      state: expect.objectContaining({
        filter: expect.objectContaining({ id: newsFilter.id }),
        otherFilters: [
          {
            id: storyFilter.id,
            pattern: storyFilter.pattern,
            matchMode: 'exact',
            description: 'That one story',
          },
        ],
      }),
    });

    chromeMock.tabs.update.mockClear();
    await expect(getTabController().continueFromBlockedPage(state!.blockId)).resolves.toBe(true);
    await expect(getBypassState(60)).resolves.toEqual({
      filterIds: [newsFilter.id, storyFilter.id],
    });

    // Arriving at the target does not put up a second block page for the other filter.
    await getTabController().evaluateNavigation(60, 'https://news.com/story');
    expect(chromeMock.tabs.update).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      60,
      { url: 'https://news.com/story' },
      expect.any(Function)
    );

    // A filter the block page never named still blocks.
    await getTabController().evaluateNavigation(60, 'https://news.com/sports');
    await expect(getBlockedTabState(60)).resolves.toMatchObject({
      blockedBy: { filterId: sportsFilter.id },
    });
  });

  it('refuses to continue when the block is unknown or the target is no longer blocked', async () => {
    const chromeMock = getChromeMock();
    await seedBlock(42, 'block-42', 'https://news.com/story');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().continueFromBlockedPage('missing-block')).resolves.toBe(false);
    // The stored rules no longer contain the filter, so there is nothing to bypass.
    await expect(getTabController().continueFromBlockedPage('block-42')).resolves.toBe(false);

    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    await expect(getBypassState(42)).resolves.toBeUndefined();
  });

  it('steps back in history whether or not a last allowed url is recorded', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await setLastAllowedUrl(43, 'https://allowed.com/page');
    await setLastAllowedUrl(44, 'https://news.com/earlier');
    await setLastAllowedUrl(45, 'chrome://newtab');

    const { getTabController } = await import('../../../src/background/tabController');
    // A real history step, so Forward returns to the block page. An entry that is blocked now is
    // stepped past where it lands, and a tab that came from a browser page (46 has nothing
    // recorded) still has that page behind it.
    for (const tabId of [43, 44, 45, 46]) {
      await expect(getTabController().goBackFromTab(tabId)).resolves.toBe(true);
      expect(chromeMock.tabs.goBack).toHaveBeenLastCalledWith(tabId, expect.any(Function));
    }
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('has nowhere to go without an earlier entry or an allowed page to reopen', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    chromeMock.tabs.goBack.mockImplementation((_tabId: number, callback?: () => void) => {
      chromeMock.runtime.lastError = { message: 'Cannot find a next page in history.' };
      callback?.();
      chromeMock.runtime.lastError = undefined;
    });
    await setLastAllowedUrl(44, 'https://news.com/earlier');
    await setLastAllowedUrl(45, 'chrome://newtab');
    await setLastAllowedUrl(47, 'https://news.com/continued');
    await setBypassState(47, { filterIds: [newsFilter.id] });

    const { getTabController } = await import('../../../src/background/tabController');
    // Reopening a page that matches a filter now would just block it again, unless the tab
    // continued past that filter.
    await expect(getTabController().goBackFromTab(44)).resolves.toBe(false);
    await expect(getTabController().goBackFromTab(45)).resolves.toBe(false);
    await expect(getTabController().goBackFromTab(46)).resolves.toBe(false);
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();

    await expect(getTabController().goBackFromTab(47)).resolves.toBe(true);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      47,
      { url: 'https://news.com/continued' },
      expect.any(Function)
    );
  });

  it('opens the last allowed url when the tab has no earlier history entry', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.goBack.mockImplementation((_tabId: number, callback?: () => void) => {
      chromeMock.runtime.lastError = { message: 'Cannot find a next page in history.' };
      callback?.();
      chromeMock.runtime.lastError = undefined;
    });
    await setLastAllowedUrl(43, 'https://allowed.com/page');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().goBackFromTab(43)).resolves.toBe(true);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      43,
      { url: 'https://allowed.com/page' },
      expect.any(Function)
    );

    // The failed step leaves no mark, so the next blocked navigation shows its block page.
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    const { getRulesProvider } = await import('../../../src/background/rulesProvider');
    getRulesProvider().invalidate();
    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(43, 'https://news.com/story');
    const state = await getBlockedTabState(43);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      43,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
  });

  it('steps past the blocked address when going back lands on it', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await seedBlock(43, 'block-43', 'https://news.com/story');
    await setLastAllowedUrl(43, 'https://allowed.com/page');

    const { getTabController } = await import('../../../src/background/tabController');
    await expect(getTabController().goBackFromTab(43)).resolves.toBe(true);
    // The blocked address committed, or came from an in-page route change, just before the block
    // page, so the first step lands on it.
    await getTabController().evaluateNavigation(43, 'https://news.com/story');
    expect(chromeMock.tabs.goBack).toHaveBeenCalledTimes(2);
    await getTabController().evaluateNavigation(43, 'https://allowed.com/page');
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();

    // The steps are used up, so a later blocked navigation shows its block page again.
    await getTabController().evaluateNavigation(43, 'https://news.com/story');
    const state = await getBlockedTabState(43);
    expect(state?.targetUrl).toBe('https://news.com/story');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      43,
      { url: blockedPageUrl(state!.blockId) },
      expect.any(Function)
    );
    expect(chromeMock.tabs.goBack).toHaveBeenCalledTimes(2);
  });

  it('lets the commit of a page wait for its start instead of cancelling a Go back step', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await seedBlock(43, 'block-43', 'https://news.com/story');
    await setLastAllowedUrl(43, 'https://allowed.com/page');

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().goBackFromTab(43);
    // The blocked entry starts and commits almost at once, as a page restored from the back/forward
    // cache does, so the commit arrives while its start is still being judged.
    await Promise.all([
      getTabController().evaluateNavigation(43, 'https://news.com/story', { beforeCommit: true }),
      getTabController().evaluateNavigation(43, 'https://news.com/story'),
    ]);

    expect(chromeMock.tabs.goBack).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('records a committed page whose start was already judged allowed', async () => {
    const { getTabController } = await import('../../../src/background/tabController');
    await Promise.all([
      getTabController().evaluateNavigation(9, 'https://allowed.com/a', { beforeCommit: true }),
      getTabController().evaluateNavigation(9, 'https://allowed.com/a'),
    ]);

    await expect(getLastAllowedUrl(9)).resolves.toBe('https://allowed.com/a');
  });

  it.each([
    ['a page the blocked address replaced', 'https://earlier.com/'],
    ['another blocked entry', 'https://news.com/earlier'],
  ])(
    'opens the last allowed url when passing the blocked address lands on %s',
    async (_case, secondLandingUrl) => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
      await seedBlock(43, 'block-43', 'https://news.com/story');
      await setLastAllowedUrl(43, 'https://allowed.com/page');

      const { getTabController } = await import('../../../src/background/tabController');
      await getTabController().goBackFromTab(43);
      await getTabController().evaluateNavigation(43, 'https://news.com/story');
      await getTabController().evaluateNavigation(43, secondLandingUrl);

      expect(chromeMock.tabs.goBack).toHaveBeenCalledTimes(2);
      expect(chromeMock.tabs.update).toHaveBeenCalledTimes(1);
      expect(chromeMock.tabs.update).toHaveBeenCalledWith(
        43,
        { url: 'https://allowed.com/page' },
        expect.any(Function)
      );
    }
  );

  it('takes a step on its commit when the entry it lands on has no before-navigate event', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await seedBlock(43, 'block-43', 'https://news.com/story');
    await setLastAllowedUrl(43, 'https://allowed.com/page');

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().goBackFromTab(43);
    await getTabController().evaluateNavigation(43, 'https://news.com/story');
    // An extension page commits without a before-navigate event.
    await getTabController().evaluateNavigation(
      43,
      'chrome-extension://test-extension-id/options.html'
    );
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      43,
      { url: 'https://allowed.com/page' },
      expect.any(Function)
    );

    // The step is used up, so later commits change nothing.
    chromeMock.tabs.update.mockClear();
    await getTabController().evaluateNavigation(
      43,
      'chrome-extension://test-extension-id/options.html'
    );
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });

  it('opens the last allowed url when there is no entry before the blocked address', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ filters: [newsFilter] }));
    await seedBlock(43, 'block-43', 'https://news.com/story');
    await setLastAllowedUrl(43, 'https://allowed.com/page');

    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().goBackFromTab(43);
    chromeMock.tabs.goBack.mockImplementation((_tabId: number, callback?: () => void) => {
      chromeMock.runtime.lastError = { message: 'Cannot find a next page in history.' };
      callback?.();
      chromeMock.runtime.lastError = undefined;
    });
    await getTabController().evaluateNavigation(43, 'https://news.com/story');

    expect(chromeMock.tabs.update).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(
      43,
      { url: 'https://allowed.com/page' },
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
    getTabController().register();
    await expect(getTabController().continueFromActiveTab()).resolves.toBe(true);

    const onChanged = chromeMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    const replacedData = createStorageData({
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
    });
    chromeMock.storage.sync._data.set(STORAGE_KEY, replacedData);
    onChanged?.({ [STORAGE_KEY]: { newValue: replacedData } }, 'sync');

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

  it('serves cached rules for navigation decisions without re-reading storage', async () => {
    const chromeMock = getChromeMock();
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
    const { getTabController } = await import('../../../src/background/tabController');
    getTabController().register();

    await getTabController().evaluateNavigation(13, 'https://blocked.com');
    const storageReadsAfterFirstNavigation = chromeMock.storage.sync.get.mock.calls.length;
    expect(storageReadsAfterFirstNavigation).toBeGreaterThan(0);

    await getTabController().evaluateNavigation(13, 'https://allowed.com/page');
    await getTabController().evaluateNavigation(13, 'https://allowed.com/page#section');

    expect(chromeMock.storage.sync.get).toHaveBeenCalledTimes(storageReadsAfterFirstNavigation);
    await expect(getTabController().getUrlDecision('https://blocked.com')).resolves.toEqual({
      action: 'block',
      filterId: 'filter-3',
      groupId: DEFAULT_GROUP_ID,
      filterIds: ['filter-3'],
      reason: 'matched-filter',
    });
  });

  it('does not redirect to the blocked page after the tab has already navigated elsewhere', async () => {
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
      })
    );

    const { getTabController } = await import('../../../src/background/tabController');
    const superseded = getTabController().evaluateNavigation(21, 'https://blocked.com/page');
    const latest = getTabController().evaluateNavigation(21, 'https://allowed.com/');
    await Promise.all([superseded, latest]);

    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    await expect(getBlockedTabState(21)).resolves.toBeUndefined();
    await expect(getLastAllowedUrl(21)).resolves.toBe('https://allowed.com/');
  });

  it('skips session writes when an allowed navigation changes nothing', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    await getTabController().evaluateNavigation(22, 'https://allowed.com/');
    chromeMock.storage.session.set.mockClear();
    chromeMock.storage.session.remove.mockClear();

    await getTabController().evaluateNavigation(22, 'https://allowed.com/');

    expect(chromeMock.storage.session.set).not.toHaveBeenCalled();
    expect(chromeMock.storage.session.remove).not.toHaveBeenCalled();
  });

  it('clears session state when a tab is closed or replaced', async () => {
    const chromeMock = getChromeMock();
    const { getTabController } = await import('../../../src/background/tabController');
    getTabController().register();
    await getTabController().evaluateNavigation(23, 'https://allowed.com/');
    await getTabController().evaluateNavigation(24, 'https://other.com/');

    const onRemoved = chromeMock.tabs.onRemoved.addListener.mock.calls[0]?.[0];
    const onReplaced = chromeMock.tabs.onReplaced.addListener.mock.calls[0]?.[0];
    onRemoved?.(23, { windowId: 1, isWindowClosing: false });
    onReplaced?.(99, 24);

    await vi.waitFor(async () => {
      await expect(getLastAllowedUrl(23)).resolves.toBeUndefined();
      await expect(getLastAllowedUrl(24)).resolves.toBeUndefined();
    });
  });

  it('schedules a rules check at the next schedule boundary and reconciles when it fires', async () => {
    const chromeMock = getChromeMock();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 8, 30));
    try {
      chromeMock.storage.sync._data.set(
        STORAGE_KEY,
        createStorageData({
          groups: [
            { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true },
            {
              id: 'work',
              name: 'Work',
              is24x7: false,
              schedules: [{ daysOfWeek: [1], startTime: '09:00', endTime: '17:00' }],
            },
          ],
          filters: [
            {
              id: 'filter-work',
              pattern: 'news.com',
              groupId: 'work',
              enabled: true,
              matchMode: 'contains',
            },
          ],
        })
      );
      chromeMock.tabs.query.mockImplementation(
        (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
          callback?.([{ id: 25, url: 'https://news.com/' } as chrome.tabs.Tab]);
        }
      );

      const { getTabController } = await import('../../../src/background/tabController');
      getTabController().register();

      await vi.waitFor(() => {
        expect(chromeMock.alarms.create).toHaveBeenCalledWith('rules-change', {
          when: new Date(2026, 8, 21, 9, 0).getTime() + 1000,
        });
      });
      expect(chromeMock.tabs.update).not.toHaveBeenCalled();

      vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 1));
      const onAlarm = chromeMock.alarms.onAlarm.addListener.mock.calls[0]?.[0];
      onAlarm?.({ name: 'rules-change', scheduledTime: Date.now() });

      await vi.waitFor(async () => {
        const state = await getBlockedTabState(25);
        expect(state?.targetUrl).toBe('https://news.com/');
        expect(chromeMock.tabs.update).toHaveBeenCalledWith(
          25,
          { url: blockedPageUrl(state!.blockId) },
          expect.any(Function)
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
