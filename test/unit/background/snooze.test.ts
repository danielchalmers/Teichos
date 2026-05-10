import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChromeMock } from '../../fixtures/chrome-mocks';
import { ALARMS, PAGES } from '../../../src/shared/constants';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';

function createActiveTimedSnooze(): { active: true; until: number } {
  return { active: true, until: Date.now() + 60_000 };
}

function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    groupId: -1,
    highlighted: false,
    id: 1,
    incognito: false,
    index: 0,
    mutedInfo: { muted: false },
    pinned: false,
    selected: false,
    status: 'complete',
    title: 'Test tab',
    url: 'https://example.com',
    windowId: 1,
    ...overrides,
  };
}

describe('registerSnoozeHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    getChromeMock().runtime.lastError = undefined;
  });

  it('registers listeners once and creates an expiration alarm for active timed snooze', async () => {
    const chromeMock = getChromeMock();
    const activeTimedSnooze = createActiveTimedSnooze();
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: activeTimedSnooze,
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
        groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
        filters: [],
        whitelist: [],
        snooze: { active: false },
      });
    });
    expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(ALARMS.SNOOZE_EXPIRATION);
  });

  it('restores blocked tabs when snooze becomes active through storage changes', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.query.mockImplementation(
      (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([
          createMockTab({
            id: 3,
            url: `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://example.com/restored')}`,
          }),
        ]);
      }
    );

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
    });

    onChanged?.({ [STORAGE_KEY]: { newValue: true } }, 'sync');

    await vi.waitFor(() => {
      expect(chromeMock.tabs.update).toHaveBeenCalledWith(
        3,
        { url: 'https://example.com/restored' },
        expect.any(Function)
      );
    });
    expect(chromeMock.storage.session._data.get('last_allowed_url_3')).toBe(
      'https://example.com/restored'
    );
  });

  it('handles snooze expiration alarms and ignores unrelated alarms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:30:00Z'));
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true, until: Date.now() - 1 },
    });

    const { registerSnoozeHandlers } = await import('../../../src/background/snooze');
    registerSnoozeHandlers();
    const onAlarm = chromeMock.alarms.onAlarm.addListener.mock.calls[0]?.[0];
    expect(onAlarm).toBeTypeOf('function');

    chromeMock.storage.sync._data.set(STORAGE_KEY, {
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true, until: Date.now() - 1 },
    });

    onAlarm?.({ name: 'other-alarm' });
    expect(chromeMock.storage.sync._data.get(STORAGE_KEY)).toEqual({
      groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
      filters: [],
      whitelist: [],
      snooze: { active: true, until: Date.now() - 1 },
    });

    onAlarm?.({ name: ALARMS.SNOOZE_EXPIRATION });

    await vi.waitFor(() => {
      expect(chromeMock.storage.sync._data.get(STORAGE_KEY)).toEqual({
        groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
        filters: [],
        whitelist: [],
        snooze: { active: false },
      });
    });
    expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
  });
});
