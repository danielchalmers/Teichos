/**
 * Filter matching and scheduling utilities
 */

import type { Filter, FilterGroup } from '../types';
import { getCurrentTimeString, getCurrentDayOfWeek } from './helpers';

/**
 * Check if a URL matches a filter pattern
 * @param url - The URL to check
 * @param pattern - The pattern to match against
 * @param isRegex - Whether to use regex matching (default: false for contains matching)
 */
export function matchesPattern(
  url: string,
  pattern: string,
  isRegex = false
): boolean {
  if (isRegex) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(url);
    } catch {
      // Invalid regex pattern - treat as no match
      return false;
    }
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
 * @param whitelist - All whitelist entries
 * @returns The matching filter if blocked, undefined if not blocked
 */
export function shouldBlockUrl(
  url: string,
  filters: readonly Filter[],
  groups: readonly FilterGroup[],
  whitelist: readonly { pattern: string; enabled: boolean; isRegex?: boolean }[]
): Filter | undefined {
  // Check whitelist first - if URL matches any enabled whitelist pattern, don't block
  for (const entry of whitelist) {
    if (entry.enabled && matchesPattern(url, entry.pattern, entry.isRegex ?? false)) {
      return undefined;
    }
  }

  // Check filters
  for (const filter of filters) {
    if (
      isFilterActive(filter, groups) &&
      matchesPattern(url, filter.pattern, filter.isRegex ?? false)
    ) {
      return filter;
    }
  }

  return undefined;
}
