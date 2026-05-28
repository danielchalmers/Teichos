import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearBlockedTabState,
  getBlockedPageState,
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedPageState,
  getSessionSnooze,
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
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
      blockedAt: 1234,
      rulesVersion: 5,
      blockedBy: {
        filterId: 'filter-1',
        groupId: 'group-1',
      },
    });

    await expect(getBlockedTabState(7)).resolves.toEqual({
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
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

  it('stores and retrieves blocked page snapshots by block id', async () => {
    await setBlockedPageState({
      blockId: 'block-page-1',
      tabId: 3,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
      blockedAt: 1234,
      rulesVersion: 6,
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
      blockType: 'block',
      blockedAt: 1234,
      rulesVersion: 6,
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

  it('ignores malformed session snooze values', async () => {
    getChromeMock().storage.session._data.set('snooze_override', { active: 'yes' });

    await expect(getSessionSnooze()).resolves.toBeUndefined();
  });
});
