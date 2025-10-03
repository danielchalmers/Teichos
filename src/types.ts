export interface TimeSchedule {
  daysOfWeek: number[]; // 0-6, Sunday-Saturday
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
}

export interface FilterGroup {
  id: string;
  name: string;
  schedules: TimeSchedule[];
  is24x7: boolean;
}

export interface Filter {
  id: string;
  pattern: string; // regex pattern
  groupId: string;
  enabled: boolean;
  description?: string;
}

export interface StorageData {
  groups: FilterGroup[];
  filters: Filter[];
}

export const DEFAULT_GROUP_ID = 'default-24x7';

export function createDefaultGroup(): FilterGroup {
  return {
    id: DEFAULT_GROUP_ID,
    name: '24/7 (Always Active)',
    schedules: [],
    is24x7: true,
  };
}

export function isFilterActive(filter: Filter, groups: FilterGroup[]): boolean {
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

export function matchesFilter(url: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(url);
  } catch (e) {
    console.error('Invalid regex pattern:', pattern, e);
    return false;
  }
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
