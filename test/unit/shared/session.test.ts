import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearBlockedTabState,
  clearBypassState,
  clearTabSessionState,
  getBlockedPageState,
  getBlockedTabState,
  getBypassState,
  getLastAllowedUrl,
  getTabSessionState,
  setBlockedPageState,
  getSessionSnooze,
  setBlockedTabState,
  setLastAllowedUrl,
  setSessionSnooze,
  setBypassState,
} from '../../../src/shared/api/session';
import type { BlockedPageState, BlockedTabState } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';

describe('shared/api/session', () => {
  beforeEach(() => {
    getChromeMock().storage.session._reset();
  });

  it('stores and retrieves last allowed URLs by tab id', async () => {
    await setLastAllowedUrl(4, 'https://example.com/allowed');

    await expect(getLastAllowedUrl(4)).resolves.toBe('https://example.com/allowed');
    await expect(getLastAllowedUrl(5)).resolves.toBeUndefined();
  });

  it('stores, retrieves, and clears blocked tab state by tab id', async () => {
    await setBlockedTabState({
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });

    await expect(getBlockedTabState(7)).resolves.toEqual({
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });

    await clearBlockedTabState(7);
    await expect(getBlockedTabState(7)).resolves.toBeUndefined();
  });

  it('stores and retrieves blocked page snapshots by block id', async () => {
    await setBlockedPageState({
      blockId: 'block-page-1',
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
      filter: {
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
        description: 'Blocked Filter',
      },
      group: {
        id: 'group-1',
        name: 'Work',
        schedules: [{ daysOfWeek: [1], startTime: '09:00', endTime: '17:00' }],
        is24x7: false,
        enabled: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });

    await expect(getBlockedPageState('block-page-1')).resolves.toEqual({
      blockId: 'block-page-1',
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
      filter: {
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
        description: 'Blocked Filter',
      },
      group: {
        id: 'group-1',
        name: 'Work',
        schedules: [{ daysOfWeek: [1], startTime: '09:00', endTime: '17:00' }],
        is24x7: false,
        enabled: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    });
  });

  it('normalizes active session snooze values', async () => {
    await setSessionSnooze({ active: true, until: 1234 });

    await expect(getSessionSnooze()).resolves.toEqual({ active: true, until: 1234 });
  });

  it('normalizes inactive session snooze values', async () => {
    await setSessionSnooze({ active: false });

    await expect(getSessionSnooze()).resolves.toEqual({ active: false });
  });

  it('stores, retrieves, and clears bypass state by tab id', async () => {
    await setBypassState(9, {
      filterId: 'bypassed-filter',
      urlKey: 'https://bypass.example.test',
    });

    await expect(getBypassState(9)).resolves.toEqual({
      filterId: 'bypassed-filter',
      urlKey: 'https://bypass.example.test',
    });

    await clearBypassState(9);
    await expect(getBypassState(9)).resolves.toBeUndefined();
  });

  it('ignores malformed session snooze values', async () => {
    getChromeMock().storage.session._data.set('snooze_override', { active: 'yes' });

    await expect(getSessionSnooze()).resolves.toBeUndefined();
  });

  it('reads all per-tab state in one storage call', async () => {
    await Promise.all([
      setLastAllowedUrl(3, 'https://allowed.com/'),
      setBypassState(3, { filterId: 'filter-1', urlKey: 'https://blocked.com/' }),
    ]);
    getChromeMock().storage.session.get.mockClear();

    await expect(getTabSessionState(3)).resolves.toEqual({
      lastAllowedUrl: 'https://allowed.com/',
      blockedTabState: undefined,
      bypass: { filterId: 'filter-1', urlKey: 'https://blocked.com/' },
    });
    expect(getChromeMock().storage.session.get).toHaveBeenCalledTimes(1);
  });

  it('clears every record for a closed tab, including its block snapshots', async () => {
    const blockedState = (tabId: number, blockId: string): BlockedTabState => ({
      blockId,
      tabId,
      targetUrl: 'https://blocked.com/',
      blockedAt: 1,
      blockedBy: { filterId: 'filter-1', groupId: 'group-1' },
    });
    const pageState = (tabId: number, blockId: string): BlockedPageState => ({
      ...blockedState(tabId, blockId),
      filter: { id: 'filter-1', pattern: 'blocked.com', matchMode: 'contains' },
      group: undefined,
      effectiveState: { filterEnabled: true, groupActive: true, snoozeActive: false },
    });
    await Promise.all([
      setLastAllowedUrl(5, 'https://allowed.com/'),
      setBypassState(5, { filterId: 'filter-1', urlKey: 'https://blocked.com/' }),
      setBlockedTabState(blockedState(5, 'block-a')),
      setBlockedPageState(pageState(5, 'block-a')),
      setBlockedPageState(pageState(5, 'block-b')),
      setBlockedPageState(pageState(6, 'block-other-tab')),
      setLastAllowedUrl(6, 'https://other.com/'),
      setSessionSnooze({ active: false }),
    ]);

    await clearTabSessionState(5);

    expect([...getChromeMock().storage.session._data.keys()].sort()).toEqual([
      'blocked_page_state_block-other-tab',
      'last_allowed_url_6',
      'snooze_override',
    ]);
  });
});
