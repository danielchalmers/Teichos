/**
 * Tests for shared/utils/filters.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchesPattern, isFilterActive, shouldBlockUrl } from '../../../src/shared/utils/filters';
import type { Filter, FilterGroup, Whitelist } from '../../../src/shared/types';

describe('matchesPattern', () => {
  it('defaults to contains matching', () => {
    expect(matchesPattern('https://example.com', 'example')).toBe(true);
    expect(matchesPattern('https://example.com', 'notfound')).toBe(false);
  });

  describe('with contains matching', () => {
    it('should match when pattern is found in URL', () => {
      expect(matchesPattern('https://example.com', 'example', 'contains')).toBe(true);
    });

    it('should not match when pattern is not found', () => {
      expect(matchesPattern('https://example.com', 'notfound', 'contains')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(matchesPattern('https://EXAMPLE.com', 'example', 'contains')).toBe(true);
      expect(matchesPattern('https://example.com', 'EXAMPLE', 'contains')).toBe(true);
    });

    it('should match substring patterns', () => {
      expect(
        matchesPattern('https://www.youtube.com/watch?v=abc', 'youtube.com/watch', 'contains')
      ).toBe(true);
      expect(
        matchesPattern('https://www.youtube.com/channel', 'youtube.com/watch', 'contains')
      ).toBe(false);
    });
  });

  describe('with exact matching', () => {
    it('should match when URL and pattern are identical', () => {
      expect(matchesPattern('https://example.com', 'https://example.com', 'exact')).toBe(true);
    });

    it('should be case insensitive for exact matches', () => {
      expect(matchesPattern('https://EXAMPLE.com', 'https://example.com', 'exact')).toBe(true);
    });

    it('should not match when URL includes extra path segments', () => {
      expect(matchesPattern('https://example.com/path', 'https://example.com', 'exact')).toBe(
        false
      );
    });
  });

  describe('with regex matching', () => {
    it('should match using regex patterns', () => {
      expect(matchesPattern('https://example.com/path', '^https://example\\.com', 'regex')).toBe(
        true
      );
    });

    it('should handle complex regex patterns', () => {
      expect(
        matchesPattern('https://www.youtube.com/watch?v=abc', 'youtube\\.com/watch', 'regex')
      ).toBe(true);
      expect(
        matchesPattern('https://www.youtube.com/channel', 'youtube\\.com/watch', 'regex')
      ).toBe(false);
    });

    it('should return false for invalid regex patterns', () => {
      expect(matchesPattern('https://example.com', '[', 'regex')).toBe(false);
    });

    it('should be case sensitive with regex by default', () => {
      expect(matchesPattern('https://EXAMPLE.com', 'example', 'regex')).toBe(false);
    });
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

describe('shouldBlockUrl', () => {
  const groups: FilterGroup[] = [
    { id: 'default', name: '24/7', schedules: [], is24x7: true },
  ];

  it('should return undefined when no filters match', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true, matchMode: 'contains' },
    ];
    expect(shouldBlockUrl('https://allowed.com', filters, groups, [])).toBeUndefined();
  });

  it('should return the matching filter when URL matches', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true, matchMode: 'contains' },
    ];
    const result = shouldBlockUrl('https://blocked.com/page', filters, groups, []);
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
    expect(shouldBlockUrl('https://blocked.com', filters, groups, [])).toBeDefined();
    expect(shouldBlockUrl('https://blocked.com/page', filters, groups, [])).toBeUndefined();
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
    expect(shouldBlockUrl('https://blocked.com/foo', filters, groups, [])).toBeDefined();
    expect(shouldBlockUrl('https://blocked.com/baz', filters, groups, [])).toBeUndefined();
  });

  it('should return undefined when URL matches whitelist', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true, matchMode: 'contains' },
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
    expect(shouldBlockUrl('https://blocked.com/allowed', filters, groups, whitelist)).toBeUndefined();
  });

  it('should allow regex whitelist entries to override filters', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true, matchMode: 'contains' },
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
      shouldBlockUrl('https://blocked.com/allowed/page', filters, groups, whitelist)
    ).toBeUndefined();
  });

  it('should block when whitelist is disabled', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true, matchMode: 'contains' },
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
    const result = shouldBlockUrl('https://blocked.com/allowed', filters, groups, whitelist);
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
    const result = shouldBlockUrl(
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

    const result = shouldBlockUrl('https://blocked.com', filters, groups, whitelist);
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

    const result = shouldBlockUrl('https://blocked.com', filters, groups, []);
    expect(result).toBeUndefined();

    vi.useRealTimers();
  });
});
