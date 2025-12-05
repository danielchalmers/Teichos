export interface TimeSchedule {
  readonly daysOfWeek: readonly number[]; // 0-6, Sunday-Saturday
  readonly startTime: string; // HH:MM format
  readonly endTime: string; // HH:MM format
}

export interface FilterGroup {
  readonly id: string;
  readonly name: string;
  readonly schedules: readonly TimeSchedule[];
  readonly is24x7: boolean;
}

export interface Filter {
  readonly id: string;
  readonly pattern: string; // regex pattern or substring to match
  readonly groupId: string;
  readonly enabled: boolean;
  readonly description?: string;
  readonly isRegex?: boolean; // true for regex matching, false for simple contains matching (default: false)
}

export interface Whitelist {
  readonly id: string;
  readonly pattern: string; // regex pattern or substring to match
  readonly enabled: boolean;
  readonly description?: string;
  readonly isRegex?: boolean; // true for regex matching, false for simple contains matching (default: false)
}

export interface StorageData {
  readonly groups: readonly FilterGroup[];
  readonly filters: readonly Filter[];
  readonly whitelist: readonly Whitelist[];
}

export const DEFAULT_GROUP_ID = 'default-24x7' as const;

export function createDefaultGroup(): FilterGroup {
  return {
    id: DEFAULT_GROUP_ID,
    name: '24/7 (Always Active)',
    schedules: [],
    is24x7: true,
  } as const;
}

export function isFilterActive(filter: Filter, groups: readonly FilterGroup[]): boolean {
  if (!filter.enabled) {
    return false;
  }

  const group = groups.find(g => g.id === filter.groupId);
  if (!group) {
    return false;
  }

  if (group.is24x7) {
    return true;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return group.schedules.some(schedule => {
    if (!schedule.daysOfWeek.includes(currentDay)) {
      return false;
    }

    return currentTime >= schedule.startTime && currentTime <= schedule.endTime;
  });
}

export function matchesFilter(url: string, pattern: string, isRegex = false): boolean {
  if (isRegex) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(url);
    } catch (error) {
      console.error('Invalid regex pattern:', pattern, error);
      return false;
    }
  }
  // Simple case-insensitive contains matching
  return url.toLowerCase().includes(pattern.toLowerCase());
}

export function generateId(): string {
  // Use crypto.randomUUID() if available, otherwise fallback to timestamp + random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
