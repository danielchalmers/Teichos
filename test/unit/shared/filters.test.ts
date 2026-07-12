/**
 * Tests for shared filtering helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRegexValidationError, matchesPattern } from '../../../src/shared/filtering/patterns';
import {
  getSnoozeRemainingMs,
  isSnoozeActive,
  isSnoozeExpired,
  isFilterActive,
  isFilterScheduledActive,
  sortFiltersTemporaryFirst,
} from '../../../src/shared/filtering/schedules';
import { evaluateFilterDecision } from '../../../src/shared/filtering/engine';
import type { Filter, FilterGroup, Whitelist } from '../../../src/shared/types';

function findBlockingFilter(
  url: string,
  filters: Filter[],
  groups: FilterGroup[],
  whitelist: Whitelist[],
  context = { dayOfWeek: 1, time: '10:00' }
): Filter | undefined {
  const decision = evaluateFilterDecision(
    url,
    {
      groups,
      filters,
      whitelist,
      snooze: { active: false },
      rulesVersion: 0,
    },
    { context }
  );

  if (decision.action !== 'block') {
    return undefined;
  }

  return filters.find((filter) => filter.id === decision.filterId);
}

describe('matchesPattern', () => {
  it.each([
    {
      name: 'defaults to contains matching',
      url: 'https://example.com',
      pattern: 'example',
      matchMode: undefined,
      expected: true,
    },
    {
      name: 'does not match missing contains pattern',
      url: 'https://example.com',
      pattern: 'notfound',
      matchMode: 'contains' as const,
      expected: false,
    },
    {
      name: 'matches contains patterns case-insensitively',
      url: 'https://EXAMPLE.com',
      pattern: 'example',
      matchMode: 'contains' as const,
      expected: true,
    },
    {
      name: 'matches exact patterns case-insensitively',
      url: 'https://EXAMPLE.com',
      pattern: 'https://example.com',
      matchMode: 'exact' as const,
      expected: true,
    },
    {
      name: 'does not match non-identical exact patterns',
      url: 'https://example.com/path',
      pattern: 'https://example.com',
      matchMode: 'exact' as const,
      expected: false,
    },
    {
      name: 'matches regex patterns',
      url: 'https://example.com/path',
      pattern: '^https://example\\.com',
      matchMode: 'regex' as const,
      expected: true,
    },
    {
      name: 'returns false for invalid regex patterns',
      url: 'https://example.com',
      pattern: '[',
      matchMode: 'regex' as const,
      expected: false,
    },
    {
      name: 'keeps regex matching case-sensitive by default',
      url: 'https://EXAMPLE.com',
      pattern: 'example',
      matchMode: 'regex' as const,
      expected: false,
    },
  ])('$name', ({ url, pattern, matchMode, expected }) => {
    expect(matchesPattern(url, pattern, matchMode)).toBe(expected);
  });
});

describe('isFilterActive', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Wednesday, January 15, 2025 10:30:00
    mockDate = new Date(2025, 0, 15, 10, 30, 0);
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false when filter is disabled', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: false,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      { id: 'group-1', name: 'Test Group', schedules: [], is24x7: true },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
  });

  it('should return false when group is not found', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'non-existent',
      enabled: true,
      matchMode: 'contains',
    };
    expect(isFilterActive(filter, [])).toBe(false);
  });

  it('should return true for enabled filter in 24/7 group', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      { id: 'group-1', name: 'Test Group', schedules: [], is24x7: true },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });

  it('should return false when the group is disabled', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      { id: 'group-1', name: 'Test Group', schedules: [], is24x7: true, enabled: false },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
    expect(isFilterScheduledActive(filter, groups)).toBe(false);
  });

  it('should return true when current time is within schedule', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      {
        id: 'group-1',
        name: 'Test Group',
        is24x7: false,
        schedules: [{ daysOfWeek: [3], startTime: '09:00', endTime: '17:00' }],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });

  it('should return false when current time is outside schedule', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      {
        id: 'group-1',
        name: 'Test Group',
        is24x7: false,
        schedules: [{ daysOfWeek: [3], startTime: '14:00', endTime: '17:00' }],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
  });

  it('should include schedule boundaries', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      {
        id: 'group-1',
        name: 'Test Group',
        is24x7: false,
        schedules: [{ daysOfWeek: [3], startTime: '10:30', endTime: '10:30' }],
      },
    ];

    expect(isFilterActive(filter, groups)).toBe(true);
  });

  it('should return false when current day is not in schedule', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    const groups: FilterGroup[] = [
      {
        id: 'group-1',
        name: 'Test Group',
        is24x7: false,
        schedules: [{ daysOfWeek: [1, 2, 4, 5], startTime: '09:00', endTime: '17:00' }],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
  });

  describe('overnight schedules crossing midnight', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
    };
    // Wednesday-only bedtime window: 22:00 until 06:00 the next (Thursday) morning.
    const groups: FilterGroup[] = [
      {
        id: 'group-1',
        name: 'Bedtime',
        is24x7: false,
        schedules: [{ daysOfWeek: [3], startTime: '22:00', endTime: '06:00' }],
      },
    ];

    it('is active after the start time on the scheduled day', () => {
      vi.setSystemTime(new Date(2025, 0, 15, 23, 30, 0)); // Wednesday 23:30
      expect(isFilterActive(filter, groups)).toBe(true);
    });

    it('stays active past midnight into the following morning', () => {
      vi.setSystemTime(new Date(2025, 0, 16, 2, 0, 0)); // Thursday 02:00
      expect(isFilterActive(filter, groups)).toBe(true);
    });

    it('includes the overnight end boundary', () => {
      vi.setSystemTime(new Date(2025, 0, 16, 6, 0, 0)); // Thursday 06:00
      expect(isFilterActive(filter, groups)).toBe(true);
    });

    it('is inactive between the morning end and the evening start', () => {
      vi.setSystemTime(new Date(2025, 0, 15, 10, 30, 0)); // Wednesday 10:30
      expect(isFilterActive(filter, groups)).toBe(false);
    });

    it('is inactive after the morning end when the new day is not scheduled', () => {
      vi.setSystemTime(new Date(2025, 0, 16, 7, 0, 0)); // Thursday 07:00
      expect(isFilterActive(filter, groups)).toBe(false);
    });

    it('does not start on an unscheduled evening', () => {
      vi.setSystemTime(new Date(2025, 0, 16, 23, 30, 0)); // Thursday 23:30
      expect(isFilterActive(filter, groups)).toBe(false);
    });
  });

  it('should return false when a temporary filter is expired', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
      expiresAt: mockDate.getTime() - 1_000,
    };
    const groups: FilterGroup[] = [
      { id: 'group-1', name: 'Test Group', schedules: [], is24x7: true },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
  });

  it('should return true when a temporary filter is still active', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
      matchMode: 'contains',
      expiresAt: mockDate.getTime() + 60_000,
    };
    const groups: FilterGroup[] = [
      { id: 'group-1', name: 'Test Group', schedules: [], is24x7: true },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });
});

describe('sortFiltersTemporaryFirst', () => {
  it('places temporary filters first while preserving relative order', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'temp 1',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
        expiresAt: Date.now() + 120_000,
      },
      { id: 'f2', pattern: 'normal 1', groupId: 'default', enabled: true, matchMode: 'contains' },
      {
        id: 'f3',
        pattern: 'temp 2',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
        expiresAt: Date.now() + 180_000,
      },
      { id: 'f4', pattern: 'normal 2', groupId: 'default', enabled: true, matchMode: 'contains' },
    ];

    const sorted = sortFiltersTemporaryFirst(filters);
    expect(sorted.map((filter) => filter.id)).toEqual(['f1', 'f3', 'f2', 'f4']);
  });
});

describe('snooze helpers', () => {
  it('should report inactive when snooze is not active', () => {
    expect(isSnoozeActive({ active: false })).toBe(false);
    expect(isSnoozeExpired({ active: false })).toBe(false);
    expect(getSnoozeRemainingMs({ active: false })).toBeNull();
  });

  it('should report active for always snooze', () => {
    expect(isSnoozeActive({ active: true })).toBe(true);
    expect(isSnoozeExpired({ active: true })).toBe(false);
    expect(getSnoozeRemainingMs({ active: true })).toBeNull();
  });

  it('should report expiration for elapsed timed snooze', () => {
    const now = new Date(2025, 0, 15, 10, 30, 0).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const snooze = { active: true, until: now - 1 };
    expect(isSnoozeActive(snooze)).toBe(false);
    expect(isSnoozeExpired(snooze)).toBe(true);
    expect(getSnoozeRemainingMs(snooze)).toBe(-1);

    vi.useRealTimers();
  });
});

describe('runtime filtering path', () => {
  const groups: FilterGroup[] = [
    { id: 'default', name: '24/7', schedules: [], is24x7: true },
    {
      id: 'work',
      name: 'Work',
      schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
      is24x7: false,
    },
  ];

  it('ignores disabled and orphaned filters and whitelist entries', () => {
    const filters: Filter[] = [
      {
        id: 'active',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
      {
        id: 'disabled',
        pattern: 'ignored.com',
        groupId: 'default',
        enabled: false,
        matchMode: 'contains',
      },
      {
        id: 'orphan',
        pattern: 'orphan.com',
        groupId: 'missing',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'allowed',
        pattern: 'blocked.com/allowed',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
      {
        id: 'disabled-whitelist',
        pattern: 'disabled.com',
        groupId: 'default',
        enabled: false,
        matchMode: 'contains',
      },
      {
        id: 'orphan-whitelist',
        pattern: 'orphan.com',
        groupId: 'missing',
        enabled: true,
        matchMode: 'contains',
      },
    ];

    expect(findBlockingFilter('https://blocked.com', filters, groups, whitelist)?.id).toBe(
      'active'
    );
    expect(
      findBlockingFilter('https://blocked.com/allowed', filters, groups, whitelist)
    ).toBeUndefined();
    expect(findBlockingFilter('https://ignored.com', filters, groups, whitelist)).toBeUndefined();
    expect(findBlockingFilter('https://orphan.com', filters, groups, whitelist)).toBeUndefined();
  });

  it('treats invalid regex patterns as non-matching', () => {
    expect(
      findBlockingFilter(
        'https://blocked.com',
        [
          {
            id: 'regex-filter',
            pattern: '[',
            groupId: 'default',
            enabled: true,
            matchMode: 'regex',
          },
        ],
        groups,
        []
      )
    ).toBeUndefined();
  });
});

describe('regex validation', () => {
  it('returns validation errors for invalid regex patterns', () => {
    expect(getRegexValidationError('^https://example\\.com')).toBeNull();
    expect(getRegexValidationError('[')).toBeTruthy();
  });
});

describe('shouldBlockUrl', () => {
  const groups: FilterGroup[] = [{ id: 'default', name: '24/7', schedules: [], is24x7: true }];

  it('should return undefined when no filters match', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    expect(findBlockingFilter('https://allowed.com', filters, groups, [])).toBeUndefined();
  });

  it('should return the matching filter when URL matches', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const result = findBlockingFilter('https://blocked.com/page', filters, groups, []);
    expect(result).toBeDefined();
    expect(result?.id).toBe('f1');
  });

  it('should respect exact matching for filters', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'https://blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'exact',
      },
    ];
    expect(findBlockingFilter('https://blocked.com', filters, groups, [])).toBeDefined();
    expect(findBlockingFilter('https://blocked.com/page', filters, groups, [])).toBeUndefined();
  });

  it('should match regex filters when configured', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: '^https://blocked\\.com/(foo|bar)$',
        groupId: 'default',
        enabled: true,
        matchMode: 'regex',
      },
    ];
    expect(findBlockingFilter('https://blocked.com/foo', filters, groups, [])).toBeDefined();
    expect(findBlockingFilter('https://blocked.com/baz', filters, groups, [])).toBeUndefined();
  });

  it('should return undefined when URL matches whitelist', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'w1',
        pattern: 'blocked.com/allowed',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    expect(
      findBlockingFilter('https://blocked.com/allowed', filters, groups, whitelist)
    ).toBeUndefined();
  });

  it('should allow regex whitelist entries to override filters', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'w1',
        pattern: '^https://blocked\\.com/allowed',
        groupId: 'default',
        enabled: true,
        matchMode: 'regex',
      },
    ];
    expect(
      findBlockingFilter('https://blocked.com/allowed/page', filters, groups, whitelist)
    ).toBeUndefined();
  });

  it('should block when whitelist is disabled', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'w1',
        pattern: 'blocked.com/allowed',
        groupId: 'default',
        enabled: false,
        matchMode: 'contains',
      },
    ];
    const result = findBlockingFilter('https://blocked.com/allowed', filters, groups, whitelist);
    expect(result).toBeDefined();
  });

  it('should ignore whitelist entries from other groups', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'work', enabled: true, matchMode: 'contains' },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'w1',
        pattern: 'blocked.com/allowed',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const result = findBlockingFilter(
      'https://blocked.com/allowed',
      filters,
      [
        { id: 'default', name: '24/7', schedules: [], is24x7: true },
        { id: 'work', name: 'Work', schedules: [], is24x7: true },
      ],
      whitelist
    );
    expect(result).toBeDefined();
  });

  it('should ignore whitelist entries for temporary filters', () => {
    const now = new Date(2025, 0, 15, 10, 30, 0).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
        expiresAt: now + 60_000,
      },
    ];
    const whitelist: Whitelist[] = [
      {
        id: 'w1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];

    const result = findBlockingFilter('https://blocked.com', filters, groups, whitelist);
    expect(result).toBeDefined();

    vi.useRealTimers();
  });

  it('should not block when temporary filters have expired', () => {
    const now = new Date(2025, 0, 15, 10, 30, 0).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
        expiresAt: now - 1,
      },
    ];

    const result = findBlockingFilter('https://blocked.com', filters, groups, []);
    expect(result).toBeUndefined();

    vi.useRealTimers();
  });

  it('should honor schedule boundaries when matching filters', () => {
    const scheduledGroups: FilterGroup[] = [
      {
        id: 'work',
        name: 'Work',
        schedules: [{ daysOfWeek: [3], startTime: '10:30', endTime: '10:30' }],
        is24x7: false,
      },
    ];
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'work',
        enabled: true,
        matchMode: 'contains',
      },
    ];

    expect(
      findBlockingFilter('https://blocked.com', filters, scheduledGroups, [], {
        dayOfWeek: 3,
        time: '10:30',
      })
    ).toBeDefined();
    expect(
      findBlockingFilter('https://blocked.com', filters, scheduledGroups, [], {
        dayOfWeek: 3,
        time: '10:31',
      })
    ).toBeUndefined();
  });

  it('should not block when the matching group is disabled', () => {
    const filters: Filter[] = [
      {
        id: 'f1',
        pattern: 'blocked.com',
        groupId: 'default',
        enabled: true,
        matchMode: 'contains',
      },
    ];
    const disabledGroups: FilterGroup[] = [
      { id: 'default', name: '24/7', schedules: [], is24x7: true, enabled: false },
    ];

    expect(findBlockingFilter('https://blocked.com', filters, disabledGroups, [])).toBeUndefined();
  });
});
