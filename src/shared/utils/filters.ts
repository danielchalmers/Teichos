/**
 * Filter matching and scheduling utilities
 */

import type { Filter, FilterGroup, FilterMatchMode, Whitelist } from '../types';
import { getCurrentTimeString, getCurrentDayOfWeek } from './helpers';

/**
 * Check if a URL matches a filter pattern
 * @param url - The URL to check
 * @param pattern - The pattern to match against
 * @param matchMode - Matching mode (default: contains)
 */
export function matchesPattern(
  url: string,
  pattern: string,
  matchMode: FilterMatchMode = 'contains'
): boolean {
  if (matchMode === 'regex') {
    try {
      const regex = new RegExp(pattern);
      return regex.test(url);
    } catch {
      // Invalid regex pattern - treat as no match
      return false;
    }
  }
  if (matchMode === 'exact') {
    return url.toLowerCase() === pattern.toLowerCase();
  }
  // Simple case-insensitive contains matching
  return url.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Check if a filter is currently active based on its group's schedule
 * @param filter - The filter to check
 * @param groups - All available filter groups
 */
export function isFilterActive(
  filter: Filter,
  groups: readonly FilterGroup[]
): boolean {
  if (!filter.enabled) {
    return false;
  }

  return isFilterScheduledActive(filter, groups);
}

/**
 * Check if a filter's group schedule is currently active
 * @param filter - The filter to check
 * @param groups - All available filter groups
 */
export function isFilterScheduledActive(
  filter: Filter,
  groups: readonly FilterGroup[]
): boolean {
  const group = groups.find((g) => g.id === filter.groupId);
  if (!group) {
    return false;
  }

  if (group.is24x7) {
    return true;
  }

  const currentDay = getCurrentDayOfWeek();
  const currentTime = getCurrentTimeString();

  return group.schedules.some((schedule) => {
    if (!schedule.daysOfWeek.includes(currentDay)) {
      return false;
    }
    return currentTime >= schedule.startTime && currentTime <= schedule.endTime;
  });
}

/**
 * Check if a URL should be blocked based on filters and whitelist
 * @param url - The URL to check
 * @param filters - All filters
 * @param groups - All filter groups
 * @param whitelist - All whitelist entries scoped to groups
 * @returns The matching filter if blocked, undefined if not blocked
 */
export function shouldBlockUrl(
  url: string,
  filters: readonly Filter[],
  groups: readonly FilterGroup[],
  whitelist: readonly Whitelist[]
): Filter | undefined {
  const whitelistByGroup = new Map<string, Whitelist[]>();
  for (const entry of whitelist) {
    if (!entry.enabled) continue;
    const groupEntries = whitelistByGroup.get(entry.groupId);
    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      whitelistByGroup.set(entry.groupId, [entry]);
    }
  }

  for (const filter of filters) {
    if (!isFilterActive(filter, groups)) {
      continue;
    }

    if (!matchesPattern(url, filter.pattern, filter.matchMode)) {
      continue;
    }

    const groupWhitelist = whitelistByGroup.get(filter.groupId);
    if (
      groupWhitelist?.some((entry) => matchesPattern(url, entry.pattern, entry.matchMode))
    ) {
      continue;
    }

    return filter;
  }

  return undefined;
}
