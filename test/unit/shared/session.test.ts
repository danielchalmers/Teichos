import { beforeEach, describe, expect, it } from 'vitest';

import {
  getLastAllowedUrl,
  getSessionSnooze,
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
