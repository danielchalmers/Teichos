import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChromeMock } from '../../fixtures/chrome-mocks';
import { ALARMS } from '../../../src/shared/constants';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createActiveTimedSnooze(): { active: true; until: number } {
  return { active: true, until: Date.now() + 60_000 };
}

describe('registerSnoozeHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers listeners once and creates an expiration alarm for active timed snooze', async () => {
    const chromeMock = getChromeMock();
    const activeTimedSnooze = createActiveTimedSnooze();
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: activeTimedSnooze,
      rulesVersion: 1,
    });

    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();
    registerSnoozeHandlers();

    expect(chromeMock.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(chromeMock.alarms.create).toHaveBeenCalledWith(ALARMS.SNOOZE_EXPIRATION, {
        when: activeTimedSnooze.until,
      });
    });
    expect(chromeMock.storage.session._data.get('snooze_override')).toEqual(activeTimedSnooze);
  });

  it('clears expired snooze state during initial sync', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:30:00Z'));
    const chromeMock = getChromeMock();
    const expired = { active: true, until: Date.now() - 1 };
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: expired,
    });

    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();

    await vi.waitFor(() => {
      expect(chromeMock.storage.sync._data.get(STORAGE_KEY)).toEqual({
        groups: [
          { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true, enabled: true },
        ],
        filters: [],
        whitelist: [],
        snooze: { active: false },
        expandBlockPageDetails: false,
        rulesVersion: 1,
      });
    });
    expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(ALARMS.SNOOZE_EXPIRATION);
  });

  it('updates session snooze state when snooze becomes active through storage changes', async () => {
    const chromeMock = getChromeMock();
    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();
    const onChanged = chromeMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    expect(onChanged).toBeTypeOf('function');

    const activeTimedSnooze = createActiveTimedSnooze();
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: activeTimedSnooze,
      rulesVersion: 2,
    });

    onChanged?.({ [STORAGE_KEY]: { newValue: true } }, 'sync');

    await vi.waitFor(() => {
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual(activeTimedSnooze);
    });
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(ALARMS.SNOOZE_EXPIRATION, {
      when: activeTimedSnooze.until,
    });
  });

  it('handles snooze expiration alarms and ignores unrelated alarms', async () => {
    const chromeMock = getChromeMock();
    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();
    // Let the initial sync settle so only the alarms below can touch storage.
    await vi.waitFor(() => {
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
    });
    const onAlarm = chromeMock.alarms.onAlarm.addListener.mock.calls[0]?.[0];
    expect(onAlarm).toBeTypeOf('function');

    // The snooze runs out without any settings write, as when its expiration alarm fires.
    const expiredSnooze = { active: true, until: Date.now() - 1 };
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: expiredSnooze,
      rulesVersion: 5,
    });

    onAlarm?.({ name: 'other-alarm' });
    await flushPromises();
    expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();

    onAlarm?.({ name: ALARMS.SNOOZE_EXPIRATION });

    await vi.waitFor(() => {
      expect(chromeMock.storage.sync._data.get(STORAGE_KEY)).toEqual({
        groups: [
          { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true, enabled: true },
        ],
        filters: [],
        whitelist: [],
        snooze: { active: false },
        expandBlockPageDetails: false,
        rulesVersion: 6,
      });
    });
    expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
    expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
  });

  it('clears the expiration alarm when a timed snooze becomes an "Always" snooze', async () => {
    const chromeMock = getChromeMock();
    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();
    await vi.waitFor(() => {
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
    });
    const onChanged = chromeMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    chromeMock.alarms.clear.mockClear();

    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true },
      rulesVersion: 2,
    });
    onChanged?.({ [STORAGE_KEY]: { newValue: true } }, 'sync');

    await vi.waitFor(() => {
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: true });
    });
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(ALARMS.SNOOZE_EXPIRATION);
    expect(chromeMock.alarms.create).not.toHaveBeenCalled();
  });
});
