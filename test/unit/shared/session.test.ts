import { beforeEach, describe, expect, it } from 'vitest';

import {
  addWarningBypass,
  clearBlockedTabState,
  clearWarningTabState,
  getBlockedTabState,
  getLastAllowedUrl,
  getSessionSnooze,
  getWarningBypasses,
  getWarningTabState,
  setBlockedTabState,
  setLastAllowedUrl,
  setSessionSnooze,
  setWarningTabState,
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

  it('stores, retrieves, and clears warning tab state by tab id', async () => {
    await setWarningTabState({
      tabId: 8,
      targetUrl: 'https://warning.example.test/focus',
      warningAt: 4321,
      rulesVersion: 6,
      bypassKey: 'https://warning.example.test',
      warnedBy: {
        filterId: 'filter-2',
        groupId: 'group-2',
      },
    });

    await expect(getWarningTabState(8)).resolves.toEqual({
      tabId: 8,
      targetUrl: 'https://warning.example.test/focus',
      warningAt: 4321,
      rulesVersion: 6,
      bypassKey: 'https://warning.example.test',
      warnedBy: {
        filterId: 'filter-2',
        groupId: 'group-2',
      },
    });

    await clearWarningTabState(8);
    await expect(getWarningTabState(8)).resolves.toBeUndefined();
  });

  it('stores unique warning bypasses by tab id', async () => {
    await addWarningBypass(3, { filterId: 'filter-1', urlKey: 'https://example.com' });
    await addWarningBypass(3, { filterId: 'filter-1', urlKey: 'https://example.com' });
    await addWarningBypass(3, { filterId: 'filter-1', urlKey: 'https://other.example.com' });

    await expect(getWarningBypasses(3)).resolves.toEqual([
      { filterId: 'filter-1', urlKey: 'https://example.com' },
      { filterId: 'filter-1', urlKey: 'https://other.example.com' },
    ]);
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
