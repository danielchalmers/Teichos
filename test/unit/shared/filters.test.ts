/**
 * Tests for shared/utils/filters.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchesPattern, isFilterActive, shouldBlockUrl } from '../../../src/shared/utils/filters';
import type { Filter, FilterGroup, Whitelist } from '../../../src/shared/types';

describe('matchesPattern', () => {
  describe('with contains matching (isRegex=false)', () => {
    it('should match when pattern is found in URL', () => {
      expect(matchesPattern('https://example.com', 'example')).toBe(true);
    });

    it('should not match when pattern is not found', () => {
      expect(matchesPattern('https://example.com', 'notfound')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(matchesPattern('https://EXAMPLE.com', 'example')).toBe(true);
      expect(matchesPattern('https://example.com', 'EXAMPLE')).toBe(true);
    });

    it('should match substring patterns', () => {
      expect(matchesPattern('https://www.youtube.com/watch?v=abc', 'youtube.com/watch')).toBe(true);
      expect(matchesPattern('https://www.youtube.com/channel', 'youtube.com/watch')).toBe(false);
    });
  });

  describe('with regex matching (isRegex=true)', () => {
    it('should match using regex patterns', () => {
      expect(matchesPattern('https://example.com/path', '^https://example\\.com', true)).toBe(true);
    });

    it('should handle complex regex patterns', () => {
      expect(matchesPattern('https://www.youtube.com/watch?v=abc', 'youtube\\.com/watch', true)).toBe(true);
      expect(matchesPattern('https://www.youtube.com/channel', 'youtube\\.com/watch', true)).toBe(false);
    });

    it('should return false for invalid regex patterns', () => {
      expect(matchesPattern('https://example.com', '[', true)).toBe(false);
    });

    it('should be case sensitive with regex by default', () => {
      expect(matchesPattern('https://EXAMPLE.com', 'example', true)).toBe(false);
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
    };
    expect(isFilterActive(filter, [])).toBe(false);
  });

  it('should return true for enabled filter in 24/7 group', () => {
    const filter: Filter = {
      id: 'filter-1',
      pattern: 'example',
      groupId: 'group-1',
      enabled: true,
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
});

describe('shouldBlockUrl', () => {
  const groups: FilterGroup[] = [
    { id: 'default', name: '24/7', schedules: [], is24x7: true },
  ];

  it('should return undefined when no filters match', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true },
    ];
    expect(shouldBlockUrl('https://allowed.com', filters, groups, [])).toBeUndefined();
  });

  it('should return the matching filter when URL matches', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true },
    ];
    const result = shouldBlockUrl('https://blocked.com/page', filters, groups, []);
    expect(result).toBeDefined();
    expect(result?.id).toBe('f1');
  });

  it('should return undefined when URL matches whitelist', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true },
    ];
    const whitelist: Whitelist[] = [
      { id: 'w1', pattern: 'blocked.com/allowed', groupId: 'default', enabled: true },
    ];
    expect(shouldBlockUrl('https://blocked.com/allowed', filters, groups, whitelist)).toBeUndefined();
  });

  it('should block when whitelist is disabled', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'default', enabled: true },
    ];
    const whitelist: Whitelist[] = [
      { id: 'w1', pattern: 'blocked.com/allowed', groupId: 'default', enabled: false },
    ];
    const result = shouldBlockUrl('https://blocked.com/allowed', filters, groups, whitelist);
    expect(result).toBeDefined();
  });

  it('should ignore whitelist entries from other groups', () => {
    const filters: Filter[] = [
      { id: 'f1', pattern: 'blocked.com', groupId: 'work', enabled: true },
    ];
    const whitelist: Whitelist[] = [
      { id: 'w1', pattern: 'blocked.com/allowed', groupId: 'default', enabled: true },
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
});
