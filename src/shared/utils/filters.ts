/**
 * Filter matching and scheduling utilities
 */

import type { Filter, FilterGroup, FilterMatchMode, Whitelist } from '../types';
import { getCurrentTimeString, getCurrentDayOfWeek } from './helpers';

export type WhitelistByGroup<T extends Whitelist = Whitelist> = ReadonlyMap<
  string,
  readonly T[]
>;
export type GroupById = ReadonlyMap<string, FilterGroup>;
export type GroupLookup = GroupById | readonly FilterGroup[];
export type ScheduleContext = {
  readonly dayOfWeek: number;
  readonly time: string;
};
export type PreparedPattern = {
  readonly pattern: string;
  readonly matchMode: FilterMatchMode;
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
};
export type PreparedFilter = Filter & {
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
};
export type PreparedWhitelist = Whitelist & {
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
};
export type BlockingIndex = {
  readonly groupsById: GroupById;
  readonly filters: readonly PreparedFilter[];
  readonly whitelistByGroup: WhitelistByGroup<PreparedWhitelist>;
};

export function isTemporaryFilter(filter: Filter): boolean {
  return typeof filter.expiresAt === 'number' && Number.isFinite(filter.expiresAt);
}

export function getTemporaryFilterRemainingMs(filter: Filter, now = Date.now()): number | null {
  if (!isTemporaryFilter(filter)) {
    return null;
  }
  return filter.expiresAt - now;
}

export function isTemporaryFilterExpired(filter: Filter, now = Date.now()): boolean {
  const remaining = getTemporaryFilterRemainingMs(filter, now);
  return remaining !== null && remaining <= 0;
}

/**
 * Return a new array with temporary filters first while preserving relative order.
 */
export function sortFiltersTemporaryFirst<T extends Filter>(filters: readonly T[]): T[] {
  const temporary: T[] = [];
  const nonTemporary: T[] = [];

  for (const filter of filters) {
    if (isTemporaryFilter(filter)) {
      temporary.push(filter);
    } else {
      nonTemporary.push(filter);
    }
  }

  return [...temporary, ...nonTemporary];
}

export function getRegexValidationError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function getScheduleContext(): ScheduleContext {
  return {
    dayOfWeek: getCurrentDayOfWeek(),
    time: getCurrentTimeString(),
  };
}

export function buildGroupById(groups: readonly FilterGroup[]): GroupById {
  return new Map(groups.map((group) => [group.id, group]));
}

/**
 * Check if a URL matches a filter pattern
 * @param url - The URL to check
 * @param pattern - The pattern to match against
 * @param matchMode - Matching mode (default: contains)
 */
export function matchesPattern(
  url: string,
  pattern: string | PreparedPattern,
  matchMode: FilterMatchMode = 'contains',
  urlLower?: string
): boolean {
  let resolvedPattern: string;
  let resolvedMode: FilterMatchMode;
  let patternLower: string | undefined;
  let regex: RegExp | null | undefined;

  if (typeof pattern === 'string') {
    resolvedPattern = pattern;
    resolvedMode = matchMode;
  } else {
    resolvedPattern = pattern.pattern;
    resolvedMode = pattern.matchMode;
    patternLower = pattern.patternLower;
    regex = pattern.regex;
  }

  if (resolvedMode === 'regex') {
    if (regex === null) {
      return false;
    }
    const resolvedRegex = regex ?? compileRegex(resolvedPattern);
    if (!resolvedRegex) {
      return false;
    }
    return resolvedRegex.test(url);
  }

  const normalizedUrl = urlLower ?? url.toLowerCase();
  const normalizedPattern = patternLower ?? resolvedPattern.toLowerCase();

  if (resolvedMode === 'exact') {
    return normalizedUrl === normalizedPattern;
  }

  return normalizedUrl.includes(normalizedPattern);
}

export function buildWhitelistByGroup(
  whitelist: readonly Whitelist[]
): WhitelistByGroup;
export function buildWhitelistByGroup<T extends Whitelist>(
  whitelist: readonly T[]
): WhitelistByGroup<T> {
  const whitelistByGroup = new Map<string, T[]>();
  for (const entry of whitelist) {
    if (!entry.enabled) {
      continue;
    }
    const groupEntries = whitelistByGroup.get(entry.groupId);
    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      whitelistByGroup.set(entry.groupId, [entry]);
    }
  }
  return whitelistByGroup;
}

export function buildBlockingIndex(
  filters: readonly Filter[],
  groups: readonly FilterGroup[],
  whitelist: readonly Whitelist[]
): BlockingIndex {
  const groupsById = buildGroupById(groups);
  const preparedFilters: PreparedFilter[] = [];
  for (const filter of filters) {
    if (!filter.enabled) {
      continue;
    }
    if (!groupsById.has(filter.groupId)) {
      continue;
    }
    preparedFilters.push(prepareFilter(filter));
  }

  const whitelistByGroup = new Map<string, PreparedWhitelist[]>();
  for (const entry of whitelist) {
    if (!entry.enabled) {
      continue;
    }
    if (!groupsById.has(entry.groupId)) {
      continue;
    }
    const preparedEntry = prepareWhitelist(entry);
    const groupEntries = whitelistByGroup.get(entry.groupId);
    if (groupEntries) {
      groupEntries.push(preparedEntry);
    } else {
      whitelistByGroup.set(entry.groupId, [preparedEntry]);
    }
  }

  return { groupsById, filters: preparedFilters, whitelistByGroup };
}

/**
 * Check if a filter is currently active based on its group's schedule
 * @param filter - The filter to check
 * @param groups - All available filter groups
 */
export function isFilterActive(
  filter: Filter,
  groups: GroupLookup,
  context: ScheduleContext = getScheduleContext()
): boolean {
  if (!filter.enabled) {
    return false;
  }

  return isFilterScheduledActive(filter, groups, context);
}

/**
 * Check if a filter's group schedule is currently active
 * @param filter - The filter to check
 * @param groups - All available filter groups
 */
export function isFilterScheduledActive(
  filter: Filter,
  groups: GroupLookup,
  context: ScheduleContext = getScheduleContext()
): boolean {
  if (isTemporaryFilterExpired(filter)) {
    return false;
  }

  const group = getGroupFromLookup(filter.groupId, groups);
  if (!group) {
    return false;
  }

  return isGroupScheduleActive(group, context);
}

export function shouldBlockUrlWithIndex(
  url: string,
  blockingIndex: BlockingIndex,
  context: ScheduleContext = getScheduleContext()
): PreparedFilter | undefined {
  if (blockingIndex.filters.length === 0) {
    return undefined;
  }

  const urlLower = url.toLowerCase();
  const now = Date.now();
  const activeGroupStatus = new Map<string, boolean>();
  const whitelistStatus = new Map<string, boolean>();

  for (const filter of blockingIndex.filters) {
    if (isTemporaryFilterExpired(filter, now)) {
      continue;
    }

    let isActive = activeGroupStatus.get(filter.groupId);
    if (isActive === undefined) {
      const group = blockingIndex.groupsById.get(filter.groupId);
      isActive = group ? isGroupScheduleActive(group, context) : false;
      activeGroupStatus.set(filter.groupId, isActive);
    }
    if (!isActive) {
      continue;
    }

    if (!isTemporaryFilter(filter)) {
      let isWhitelisted = whitelistStatus.get(filter.groupId);
      if (isWhitelisted === undefined) {
        const groupWhitelist = blockingIndex.whitelistByGroup.get(filter.groupId);
        isWhitelisted = groupWhitelist
          ? groupWhitelist.some((entry) => matchesPattern(url, entry, undefined, urlLower))
          : false;
        whitelistStatus.set(filter.groupId, isWhitelisted);
      }
      if (isWhitelisted) {
        continue;
      }
    }

    if (matchesPattern(url, filter, undefined, urlLower)) {
      return filter;
    }
  }

  return undefined;
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
  const blockingIndex = buildBlockingIndex(filters, groups, whitelist);
  return shouldBlockUrlWithIndex(url, blockingIndex);
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function preparePattern(
  pattern: string,
  matchMode: FilterMatchMode
): Pick<PreparedPattern, 'patternLower' | 'regex'> {
  if (matchMode === 'regex') {
    return { regex: compileRegex(pattern) };
  }
  return { patternLower: pattern.toLowerCase() };
}

function prepareFilter(filter: Filter): PreparedFilter {
  return {
    ...filter,
    ...preparePattern(filter.pattern, filter.matchMode),
  };
}

function prepareWhitelist(entry: Whitelist): PreparedWhitelist {
  return {
    ...entry,
    ...preparePattern(entry.pattern, entry.matchMode),
  };
}

function getGroupFromLookup(
  groupId: string,
  groups: GroupLookup
): FilterGroup | undefined {
  if (groups instanceof Map) {
    return groups.get(groupId);
  }
  return groups.find((group) => group.id === groupId);
}

function isGroupScheduleActive(group: FilterGroup, context: ScheduleContext): boolean {
  if (group.is24x7) {
    return true;
  }

  return group.schedules.some((schedule) => {
    if (!schedule.daysOfWeek.includes(context.dayOfWeek)) {
      return false;
    }
    return context.time >= schedule.startTime && context.time <= schedule.endTime;
  });
}
