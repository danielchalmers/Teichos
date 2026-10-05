import { DAY_NAMES } from '../constants';
import type { FilterGroup, SnoozeState, TimeSchedule } from '../types';
import { formatDuration } from './helpers';

export function formatGroupScheduleSummary(group: FilterGroup): string {
  if (group.is24x7) {
    return 'Always active';
  }

  if (group.schedules.length === 0) {
    return 'No schedule';
  }

  return group.schedules.map(formatScheduleSummary).join('; ');
}

export function formatScheduleSummary(schedule: TimeSchedule): string {
  return `${formatScheduleDays(schedule.daysOfWeek)} ${schedule.startTime}–${schedule.endTime}`;
}

export function formatScheduleDays(daysOfWeek: readonly number[]): string {
  const uniqueDays = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  if (uniqueDays.length === DAY_NAMES.length) {
    return 'Daily';
  }

  if (uniqueDays.length === 0) {
    return 'No days';
  }

  const dayRanges: string[] = [];
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;

  for (const day of uniqueDays) {
    if (rangeStart === null || rangeEnd === null) {
      rangeStart = day;
      rangeEnd = day;
      continue;
    }

    if (day === rangeEnd + 1) {
      rangeEnd = day;
      continue;
    }

    dayRanges.push(formatScheduleDayRange(rangeStart, rangeEnd));
    rangeStart = day;
    rangeEnd = day;
  }

  if (rangeStart !== null && rangeEnd !== null) {
    dayRanges.push(formatScheduleDayRange(rangeStart, rangeEnd));
  }

  return dayRanges.join(', ');
}

function formatScheduleDayRange(startDay: number, endDay: number): string {
  if (startDay === endDay) {
    return DAY_NAMES[startDay] ?? 'Unknown';
  }

  return `${DAY_NAMES[startDay] ?? 'Unknown'}–${DAY_NAMES[endDay] ?? 'Unknown'}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Describe a moment as a clock time, e.g. "until 3:45 PM". It adds the weekday when the moment
 * falls on another day within the next six days, and the date when it is a week or more away, so
 * a weekday never reads as today's. An absolute time stays correct without a ticking countdown,
 * so it is safe in text that screen readers may revisit.
 */
export function formatUntil(timestamp: number, now = Date.now(), locale?: string): string {
  const end = new Date(timestamp);
  // Beyond the Date range (about 275,000 years away) there is no clock time to show.
  if (Number.isNaN(end.getTime())) {
    return 'until further notice';
  }
  // Rounding absorbs the 23- and 25-hour days around daylight saving changes.
  const dayDiff = Math.round((startOfDay(end) - startOfDay(new Date(now))) / DAY_MS);
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (dayDiff >= 7) {
    options.month = 'short';
    options.day = 'numeric';
  } else if (dayDiff !== 0) {
    options.weekday = 'short';
  }

  return `until ${new Intl.DateTimeFormat(locale, options).format(end)}`;
}

/** Describe when a snooze ends, e.g. "until 3:45 PM", or "until you resume it" when it has no end. */
export function formatSnoozeEnd(snooze: SnoozeState, now = Date.now(), locale?: string): string {
  if (typeof snooze.until !== 'number' || !Number.isFinite(snooze.until)) {
    return 'until you resume it';
  }

  return formatUntil(snooze.until, now, locale);
}

/** Label for a temporary filter, e.g. "Temporary · 45m left", or "Temporary · expired". */
export function formatTemporaryFilterLabel(remainingMs: number): string {
  return remainingMs <= 0
    ? 'Temporary · expired'
    : `Temporary · ${formatDuration(remainingMs)} left`;
}
