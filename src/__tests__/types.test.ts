import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDefaultGroup,
  isFilterActive,
  matchesFilter,
  generateId,
  DEFAULT_GROUP_ID,
  Filter,
  FilterGroup,
} from '../types';

describe('createDefaultGroup', () => {
  it('should create a default group with the correct id', () => {
    const group = createDefaultGroup();
    expect(group.id).toBe(DEFAULT_GROUP_ID);
  });

  it('should create a group with 24/7 active', () => {
    const group = createDefaultGroup();
    expect(group.is24x7).toBe(true);
  });

  it('should create a group with empty schedules', () => {
    const group = createDefaultGroup();
    expect(group.schedules).toEqual([]);
  });

  it('should create a group with the correct name', () => {
    const group = createDefaultGroup();
    expect(group.name).toBe('24/7 (Always Active)');
  });
});

describe('matchesFilter', () => {
  describe('with default contains matching (isRegex=false)', () => {
    it('should match a simple URL with a matching pattern', () => {
      expect(matchesFilter('https://example.com', 'example')).toBe(true);
    });

    it('should not match when pattern does not match URL', () => {
      expect(matchesFilter('https://example.com', 'notfound')).toBe(false);
    });

    it('should be case insensitive by default', () => {
      expect(matchesFilter('https://EXAMPLE.com', 'example')).toBe(true);
      expect(matchesFilter('https://example.com', 'EXAMPLE')).toBe(true);
    });

    it('should match substring patterns', () => {
      expect(matchesFilter('https://www.youtube.com/watch?v=abc123', 'youtube.com/watch')).toBe(true);
      expect(matchesFilter('https://www.youtube.com/channel/xyz', 'youtube.com/watch')).toBe(false);
    });
  });

  describe('with regex matching (isRegex=true)', () => {
    it('should match using regex patterns', () => {
      expect(matchesFilter('https://example.com/path', '^https://example\\.com', true)).toBe(true);
    });

    it('should handle complex regex patterns', () => {
      expect(matchesFilter('https://www.youtube.com/watch?v=abc123', 'youtube\\.com/watch', true)).toBe(true);
      expect(matchesFilter('https://www.youtube.com/channel/xyz', 'youtube\\.com/watch', true)).toBe(false);
    });

    it('should return false for invalid regex patterns', () => {
      // Invalid regex (unmatched bracket)
      expect(matchesFilter('https://example.com', '[', true)).toBe(false);
    });

    it('should be case sensitive with regex', () => {
      expect(matchesFilter('https://EXAMPLE.com', 'example', true)).toBe(false);
      expect(matchesFilter('https://example.com', 'EXAMPLE', true)).toBe(false);
    });

    it('should support case insensitive regex with flag', () => {
      // JS regex with i flag using regex pattern
      expect(matchesFilter('https://EXAMPLE.com', '[Ee][Xx][Aa][Mm][Pp][Ll][Ee]', true)).toBe(true);
    });
  });
});

describe('isFilterActive', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock Date to a known value: Wednesday, January 15, 2025 10:30:00
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
      groupId: 'non-existent-group',
      enabled: true,
    };
    const groups: FilterGroup[] = [];
    expect(isFilterActive(filter, groups)).toBe(false);
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
    // Wednesday is day 3
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
        schedules: [
          { daysOfWeek: [3], startTime: '09:00', endTime: '17:00' },
        ],
      },
    ];
    // Current time is 10:30, which is within 09:00-17:00
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
        schedules: [
          { daysOfWeek: [3], startTime: '14:00', endTime: '17:00' },
        ],
      },
    ];
    // Current time is 10:30, which is outside 14:00-17:00
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
        schedules: [
          { daysOfWeek: [1, 2, 4, 5], startTime: '09:00', endTime: '17:00' }, // Excludes Wednesday (3)
        ],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(false);
  });

  it('should return true when any schedule matches', () => {
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
        schedules: [
          { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' }, // Monday, doesn't match
          { daysOfWeek: [3], startTime: '10:00', endTime: '11:00' }, // Wednesday 10:00-11:00, matches
        ],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });

  it('should return true when current time is at the start of schedule', () => {
    vi.setSystemTime(new Date(2025, 0, 15, 9, 0, 0)); // 09:00
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
        schedules: [
          { daysOfWeek: [3], startTime: '09:00', endTime: '17:00' },
        ],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });

  it('should return true when current time is at the end of schedule', () => {
    vi.setSystemTime(new Date(2025, 0, 15, 17, 0, 0)); // 17:00
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
        schedules: [
          { daysOfWeek: [3], startTime: '09:00', endTime: '17:00' },
        ],
      },
    ];
    expect(isFilterActive(filter, groups)).toBe(true);
  });
});

describe('generateId', () => {
  it('should generate a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('should contain a hyphen separator', () => {
    const id = generateId();
    expect(id).toContain('-');
  });
});
