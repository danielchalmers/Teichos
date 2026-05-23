import { describe, expect, it, vi } from 'vitest';

import type { StorageData } from '../../../src/shared/types';
import { DEFAULT_GROUP_ID } from '../../../src/shared/types';
import {
  createFilteringEngine,
  evaluateFilterDecision,
  getWarningBypassScopeKey,
} from '../../../src/shared/utils';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [
      { id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true },
    ],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    blockType: overrides.blockType ?? 'block',
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
      blockType: 'block',
      reason: 'matched-filter',
    });
  });

  it('uses the global warning block type by default', () => {
    const decision = evaluateFilterDecision(
      'https://warning.com',
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.com',
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
      filterId: 'warning-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'warning',
      reason: 'matched-filter',
    });
  });

  it('respects per-filter block type overrides', () => {
    const warningDecision = evaluateFilterDecision(
      'https://warning-override.com',
      createStorageData({
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning-override.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'warning',
          },
        ],
      }),
      { context: activeContext }
    );
    const hardBlockDecision = evaluateFilterDecision(
      'https://hard-override.com',
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'block-filter',
            pattern: 'hard-override.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'block',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(warningDecision).toMatchObject({ action: 'block', blockType: 'warning' });
    expect(hardBlockDecision).toMatchObject({ action: 'block', blockType: 'block' });
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
      blockType: 'block',
      reason: 'matched-filter',
    });
  });

  it('prefers a hard block over an earlier warning match', () => {
    const decision = evaluateFilterDecision(
      'https://mixed.example.com',
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'mixed.example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
          {
            id: 'block-filter',
            pattern: 'mixed.example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'block',
          },
        ],
      }),
      { context: activeContext }
    );

    expect(decision).toEqual({
      action: 'block',
      filterId: 'block-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
  });

  it('allows warning matches that were bypassed for the same filter and origin', () => {
    const bypassedUrl = 'https://warning.example.com/path';
    const bypassedDecision = evaluateFilterDecision(
      bypassedUrl,
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
      }),
      {
        context: activeContext,
        warningBypasses: [
          {
            filterId: 'warning-filter',
            scopeKey: getWarningBypassScopeKey(bypassedUrl),
          },
        ],
      }
    );
    const unbypassedDecision = evaluateFilterDecision(
      'https://warning.example.com/path',
      createStorageData({
        blockType: 'warning',
        filters: [
          {
            id: 'warning-filter',
            pattern: 'warning.example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
          {
            id: 'other-warning-filter',
            pattern: 'warning.example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'warning',
          },
        ],
      }),
      {
        context: activeContext,
        warningBypasses: [
          {
            filterId: 'warning-filter',
            scopeKey: getWarningBypassScopeKey('https://warning.example.com/path'),
          },
        ],
      }
    );

    expect(bypassedDecision).toEqual({ action: 'allow', reason: 'warning-bypassed' });
    expect(unbypassedDecision).toEqual({
      action: 'block',
      filterId: 'other-warning-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'warning',
      reason: 'matched-filter',
    });
  });
});
