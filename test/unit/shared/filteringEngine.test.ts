import { describe, expect, it, vi } from 'vitest';

import type { StorageData } from '../../../src/shared/types';
import { DEFAULT_GROUP_ID } from '../../../src/shared/types';
import { createFilteringEngine, evaluateFilterDecision } from '../../../src/shared/utils';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [
      { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true, enabled: true },
    ],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    rulesVersion: overrides.rulesVersion ?? 0,
  };
}

describe('filteringEngine', () => {
  const activeContext = { dayOfWeek: 1, time: '10:00' } as const;

  it('allows matching urls when the filter is disabled', () => {
    const decision = evaluateFilterDecision(
      'https://blocked.com',
      createStorageData({
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: false,
            matchMode: 'contains',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({ action: 'allow', reason: 'filter-disabled' });
  });

  it('allows matching urls when snooze is active', () => {
    const engine = createFilteringEngine(
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
        snooze: { active: true },
      })
    );

    expect(engine.evaluate('https://blocked.com')).toEqual({ action: 'allow', reason: 'snoozed' });
  });

  it('allows matching urls when a whitelist entry matches', () => {
    const decision = evaluateFilterDecision(
      'https://blocked.com/allowed',
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
        whitelist: [
          {
            id: 'whitelist-1',
            pattern: 'blocked.com/allowed',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({ action: 'allow', reason: 'whitelisted' });
  });

  it('blocks matching urls when the group is active', () => {
    const decision = evaluateFilterDecision(
      'https://blocked.com',
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
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({
      action: 'block',
      filterId: 'filter-1',
      groupId: DEFAULT_GROUP_ID,
      reason: 'matched-filter',
    });
  });

  it('allows matching urls when the group schedule is inactive', () => {
    const decision = evaluateFilterDecision(
      'https://blocked.com',
      createStorageData({
        groups: [
          {
            id: 'work',
            name: 'Work',
            is24x7: false,
            schedules: [{ daysOfWeek: [2], startTime: '09:00', endTime: '17:00' }],
          },
        ],
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: 'work',
            enabled: true,
            matchMode: 'contains',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({ action: 'allow', reason: 'group-inactive' });
  });

  it('allows matching urls when the group is disabled and blocks again when re-enabled', () => {
    const disabledData = createStorageData({
      groups: [{ id: 'work', name: 'Work', is24x7: true, schedules: [], enabled: false }],
      filters: [
        {
          id: 'filter-1',
          pattern: 'blocked.com',
          groupId: 'work',
          enabled: true,
          matchMode: 'contains',
        },
      ],
    });

    expect(evaluateFilterDecision('https://blocked.com', disabledData, { context: activeContext })).toEqual(
      { action: 'allow', reason: 'group-inactive' }
    );

    const reenabledData = {
      ...disabledData,
      groups: disabledData.groups.map((group) => ({ ...group, enabled: true })),
    };

    expect(
      evaluateFilterDecision('https://blocked.com', reenabledData, { context: activeContext })
    ).toEqual({
      action: 'block',
      filterId: 'filter-1',
      groupId: 'work',
      reason: 'matched-filter',
    });
  });

  it('allows matching urls when a temporary filter has expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));

    const decision = evaluateFilterDecision(
      'https://blocked.com',
      createStorageData({
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            expiresAt: Date.now() - 1,
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({ action: 'allow', reason: 'temporary-expired' });
    vi.useRealTimers();
  });

  it('prefers a blocking match over earlier allowed fallbacks', () => {
    const decision = evaluateFilterDecision(
      'https://blocked.com',
      createStorageData({
        filters: [
          {
            id: 'disabled-filter',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: false,
            matchMode: 'contains',
          },
          {
            id: 'active-filter',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({
      action: 'block',
      filterId: 'active-filter',
      groupId: DEFAULT_GROUP_ID,
      reason: 'matched-filter',
    });
  });
});
