import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearBlockedTabState,
  getBlockedPageState,
  getBlockedTabState,
  getLastAllowedUrl,
  getSessionSnooze,
  setBlockedPageState,
  setBlockedTabState,
  setLastAllowedUrl,
  setSessionSnooze,
} from '../../../src/shared/api/session';
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
      blockId: 'block-1',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });

    await expect(getBlockedTabState(7)).resolves.toEqual({
      blockId: 'block-1',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });

    await clearBlockedTabState(7);
    await expect(getBlockedTabState(7)).resolves.toBeUndefined();
  });

  it('stores, retrieves, and clears blocked page state by block id', async () => {
    await setBlockedTabState({
      blockId: 'block-2',
      tabId: 8,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });
    await setBlockedPageState({
      blockId: 'block-2',
      tabId: 8,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
      filter: {
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
        description: 'Blocked Site',
      },
      group: {
        id: 'group-1',
        name: 'Focus',
        is24x7: true,
        schedules: [],
      },
    });

    await expect(getBlockedPageState('block-2')).resolves.toEqual({
      blockId: 'block-2',
      tabId: 8,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
      filter: {
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
        description: 'Blocked Site',
      },
      group: {
        id: 'group-1',
        name: 'Focus',
        is24x7: true,
        schedules: [],
      },
    });

    await clearBlockedTabState(8);
    await expect(getBlockedTabState(8)).resolves.toBeUndefined();
    await expect(getBlockedPageState('block-2')).resolves.toBeUndefined();
  });

  it('normalizes active session snooze values', async () => {
    await setSessionSnooze({ active: true, until: 1234 });

    await expect(getSessionSnooze()).resolves.toEqual({ active: true, until: 1234 });
  });

  it('normalizes inactive session snooze values', async () => {
    await setSessionSnooze({ active: false });

    await expect(getSessionSnooze()).resolves.toEqual({ active: false });
  });

  it('ignores malformed session snooze values', async () => {
    getChromeMock().storage.session._data.set('snooze_override', { active: 'yes' });

    await expect(getSessionSnooze()).resolves.toBeUndefined();
  });
});
