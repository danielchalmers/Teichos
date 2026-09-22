import type {
  Filter,
  FilterGroup,
  SnoozeState,
  StorageData,
  TimeSchedule,
  Whitelist,
} from '../types';
import { getCurrentDayOfWeek, getCurrentTimeString } from '../utils/helpers';

export type WhitelistByGroup<T extends Whitelist = Whitelist> = ReadonlyMap<string, readonly T[]>;
export type GroupById = ReadonlyMap<string, FilterGroup>;
export type GroupLookup = GroupById | readonly FilterGroup[];

export interface ScheduleContext {
  readonly dayOfWeek: number;
  readonly time: string;
}

export interface FilterEffectiveState {
  readonly filterEnabled: boolean;
  readonly groupEnabled: boolean;
  readonly groupActive: boolean;
  readonly active: boolean;
}

export function isTemporaryFilter(filter: Filter): filter is Filter & { expiresAt: number } {
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

export function getSnoozeRemainingMs(
  snooze: SnoozeState | undefined,
  now = Date.now()
): number | null {
  if (!snooze?.active) {
    return null;
  }

  if (typeof snooze.until !== 'number' || !Number.isFinite(snooze.until)) {
    return null;
  }

  return snooze.until - now;
}

export function isSnoozeActive(snooze: SnoozeState | undefined, now = Date.now()): boolean {
  if (!snooze?.active) {
    return false;
  }

  const remaining = getSnoozeRemainingMs(snooze, now);
  return remaining === null || remaining > 0;
}

export function isSnoozeExpired(snooze: SnoozeState | undefined, now = Date.now()): boolean {
  if (!snooze?.active) {
    return false;
  }

  const remaining = getSnoozeRemainingMs(snooze, now);
  return remaining !== null && remaining <= 0;
}

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

export function getScheduleContext(): ScheduleContext {
  return {
    dayOfWeek: getCurrentDayOfWeek(),
    time: getCurrentTimeString(),
  };
}

export function buildGroupById(groups: readonly FilterGroup[]): GroupById {
  return new Map(groups.map((group) => [group.id, group]));
}

export function buildWhitelistByGroup(whitelist: readonly Whitelist[]): WhitelistByGroup;
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

export function isGroupEnabled(group: FilterGroup | undefined): boolean {
  return group?.enabled !== false;
}

export function isFilterActive(
  filter: Filter,
  groups: GroupLookup,
  context: ScheduleContext = getScheduleContext()
): boolean {
  return getFilterEffectiveState(filter, groups, context).active;
}

export function isFilterScheduledActive(
  filter: Filter,
  groups: GroupLookup,
  context: ScheduleContext = getScheduleContext()
): boolean {
  return getFilterEffectiveState(filter, groups, context).groupActive;
}

export function getFilterEffectiveState(
  filter: Filter,
  groups: GroupLookup,
  context: ScheduleContext = getScheduleContext(),
  now = Date.now()
): FilterEffectiveState {
  const expired = isTemporaryFilterExpired(filter, now);
  if (expired) {
    return {
      filterEnabled: filter.enabled,
      groupEnabled: false,
      groupActive: false,
      active: false,
    };
  }

  const group = getGroupFromLookup(filter.groupId, groups);
  if (!group) {
    return {
      filterEnabled: filter.enabled,
      groupEnabled: false,
      groupActive: false,
      active: false,
    };
  }

  const groupEnabled = isGroupEnabled(group);
  const groupActive = groupEnabled && isGroupScheduleActive(group, context);

  return {
    filterEnabled: filter.enabled,
    groupEnabled,
    groupActive,
    active: filter.enabled && groupActive,
  };
}

function getGroupFromLookup(groupId: string, groups: GroupLookup): FilterGroup | undefined {
  if (Array.isArray(groups)) {
    return groups.find((group) => group.id === groupId);
  }
  return (groups as GroupById).get(groupId);
}

function isGroupScheduleActive(group: FilterGroup, context: ScheduleContext): boolean {
  if (group.is24x7) {
    return true;
  }

  return group.schedules.some((schedule) => isScheduleActive(schedule, context));
}

/**
 * Whether a schedule covers the given moment. A schedule whose start time is later than its end
 * time crosses midnight: it runs from startTime on each scheduled day until endTime the following
 * morning, so the post-midnight portion belongs to the previous day's schedule entry.
 */
function isScheduleActive(schedule: TimeSchedule, context: ScheduleContext): boolean {
  if (schedule.startTime <= schedule.endTime) {
    return (
      schedule.daysOfWeek.includes(context.dayOfWeek) &&
      context.time >= schedule.startTime &&
      context.time <= schedule.endTime
    );
  }

  if (schedule.daysOfWeek.includes(context.dayOfWeek) && context.time >= schedule.startTime) {
    return true;
  }

  const previousDay = (context.dayOfWeek + 6) % 7;
  return schedule.daysOfWeek.includes(previousDay) && context.time <= schedule.endTime;
}

/**
 * The earliest moment after `now` at which a decision can change without a settings write: a
 * schedule window opening or closing, or a temporary filter expiring. Windows have minute
 * resolution and include their end minute, so a window closes when the minute after endTime
 * starts. Days of the week are ignored; at worst that re-checks tabs on a day a window does not
 * apply. Snooze expiry is not included because the snooze alarm already rewrites settings.
 */
export function getNextRulesChangeAt(data: StorageData, now = Date.now()): number | null {
  let next: number | null = null;
  const consider = (candidate: number | null): void => {
    if (candidate !== null && candidate > now && (next === null || candidate < next)) {
      next = candidate;
    }
  };

  for (const filter of data.filters) {
    if (isTemporaryFilter(filter)) {
      consider(filter.expiresAt);
    }
  }

  for (const group of data.groups) {
    if (!isGroupEnabled(group) || group.is24x7) {
      continue;
    }
    for (const schedule of group.schedules) {
      consider(getNextTimeOfDay(schedule.startTime, 0, now));
      consider(getNextTimeOfDay(schedule.endTime, 1, now));
    }
  }

  return next;
}

function getNextTimeOfDay(time: string, offsetMinutes: number, now: number): number | null {
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours + minutes)) {
    return null;
  }

  const candidate = new Date(now);
  candidate.setHours(hours, minutes + offsetMinutes, 0, 0);
  if (candidate.getTime() <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}
