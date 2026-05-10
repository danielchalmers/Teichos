import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';
import { setSessionSnooze } from '../../../src/shared/api/session';
import { isSnoozeBypassActive } from '../../../src/background/snoozeBypass';

describe('isSnoozeBypassActive', () => {
  beforeEach(() => {
    getChromeMock().storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: false },
    });
  });

  it('prefers active session snooze state', async () => {
    await setSessionSnooze({ active: true });

    await expect(isSnoozeBypassActive()).resolves.toBe(true);
  });

  it('falls back to raw sync storage when session snooze is inactive', async () => {
    await setSessionSnooze({ active: false });
    getChromeMock().storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true },
    });

    await expect(isSnoozeBypassActive()).resolves.toBe(true);
  });

  it('treats expired raw snooze values as inactive', async () => {
    await setSessionSnooze({ active: false });
    getChromeMock().storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true, until: Date.now() - 1 },
    });

    await expect(isSnoozeBypassActive()).resolves.toBe(false);
  });
});
