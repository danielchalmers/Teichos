import { describe, expect, it } from 'vitest';

import {
  clearBlockedTabState,
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

  it('keeps the other filters behind a block and drops malformed ones', async () => {
    const chromeMock = getChromeMock();
    const blockedBy = {
      filterId: 'filter-1',
      groupId: 'group-1',
      otherFilterIds: ['filter-2', 42, 'filter-3'],
    };
    chromeMock.storage.session._data.set('blocked_tab_state_3', {
      blockId: 'block-page-2',
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy,
    });
    chromeMock.storage.session._data.set('blocked_page_state_block-page-2', {
      blockId: 'block-page-2',
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy,
      filter: { id: 'filter-1', pattern: 'blocked.com', matchMode: 'contains' },
      otherFilters: [
        { id: 'filter-2', pattern: 'blocked.com/focus', matchMode: 'contains' },
        { id: 'broken', pattern: 7, matchMode: 'contains' },
        { id: 'filter-3', pattern: 'https://blocked.com/focus', matchMode: 'exact' },
      ],
      group: undefined,
      effectiveState: { filterEnabled: true, groupActive: true, snoozeActive: false },
    });

    const expectedBlockedBy = {
      filterId: 'filter-1',
      groupId: 'group-1',
      otherFilterIds: ['filter-2', 'filter-3'],
    };
    await expect(getBlockedTabState(3)).resolves.toMatchObject({ blockedBy: expectedBlockedBy });
    await expect(getBlockedPageState('block-page-2')).resolves.toMatchObject({
      blockedBy: expectedBlockedBy,
      otherFilters: [
        { id: 'filter-2', pattern: 'blocked.com/focus', matchMode: 'contains' },
        { id: 'filter-3', pattern: 'https://blocked.com/focus', matchMode: 'exact' },
      ],
    });
  });

  it('keeps a temporary filter expiry in blocked page snapshots only when it is a finite time', async () => {
    const pageState = (blockId: string, expiresAt: unknown): unknown => ({
      blockId,
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: { filterId: 'filter-1', groupId: 'group-1' },
      filter: { id: 'filter-1', pattern: 'blocked.com', matchMode: 'contains', expiresAt },
      group: undefined,
      effectiveState: { filterEnabled: true, groupActive: true, snoozeActive: false },
    });
    const session = getChromeMock().storage.session._data;
    session.set('blocked_page_state_temporary', pageState('temporary', 5_000));
    session.set('blocked_page_state_text', pageState('text', '5000'));
    session.set('blocked_page_state_infinite', pageState('infinite', Infinity));
    session.set('blocked_page_state_nan', pageState('nan', Number.NaN));

    await expect(getBlockedPageState('temporary')).resolves.toMatchObject({
      filter: { id: 'filter-1', pattern: 'blocked.com', matchMode: 'contains', expiresAt: 5_000 },
    });
    // A malformed expiry is dropped rather than failing the whole snapshot.
    for (const blockId of ['text', 'infinite', 'nan']) {
      const state = await getBlockedPageState(blockId);
      expect(state?.filter).toEqual({
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
      });
    }
  });

  it('normalizes active session snooze values', async () => {
    await setSessionSnooze({ active: true, until: 1234 });

    await expect(getSessionSnooze()).resolves.toEqual({ active: true, until: 1234 });
  });

  it('normalizes inactive session snooze values', async () => {
    await setSessionSnooze({ active: false });

    await expect(getSessionSnooze()).resolves.toEqual({ active: false });
  });

  it('stores and retrieves bypass state by tab id', async () => {
    await setBypassState(9, { filterIds: ['bypassed-filter'] });

    await expect(getBypassState(9)).resolves.toEqual({ filterIds: ['bypassed-filter'] });
    await expect(getBypassState(10)).resolves.toBeUndefined();
  });

  it('ignores malformed bypass state', async () => {
    const session = getChromeMock().storage.session._data;
    session.set('bypass_11', { filterId: 'old-shape', urlKey: 'https://blocked.com/' });
    session.set('bypass_12', { filterIds: ['kept', 7, null] });

    await expect(getBypassState(11)).resolves.toBeUndefined();
    await expect(getBypassState(12)).resolves.toEqual({ filterIds: ['kept'] });
  });

  it('ignores malformed session snooze values', async () => {
    getChromeMock().storage.session._data.set('snooze_override', { active: 'yes' });

    await expect(getSessionSnooze()).resolves.toBeUndefined();
  });

  it('reads all per-tab state in one storage call', async () => {
    await Promise.all([
      setLastAllowedUrl(3, 'https://allowed.com/'),
      setBypassState(3, { filterIds: ['filter-1'] }),
    ]);
    getChromeMock().storage.session.get.mockClear();

    await expect(getTabSessionState(3)).resolves.toEqual({
      lastAllowedUrl: 'https://allowed.com/',
      blockedTabState: undefined,
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
      setBypassState(5, { filterIds: ['filter-1'] }),
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
