import { DAY_NAMES } from '../constants';
import type { FilterGroup, SnoozeState, TimeSchedule } from '../types';
import { formatDuration, isValidTimeString } from './helpers';

/** A no-break space: it keeps a clock time with its AM/PM, and a spaced dash with both its times. */
const NO_BREAK_SPACE = ' ';

export function formatGroupScheduleSummary(group: FilterGroup, locale?: string): string {
  if (group.is24x7) {
    return 'Always active';
  }

  if (group.schedules.length === 0) {
    return 'No schedule';
  }

  return group.schedules.map((schedule) => formatScheduleSummary(schedule, locale)).join('; ');
}

/** One schedule's days and hours, e.g. "Mon–Fri 9:00 AM – 5:00 PM", or "Mon–Fri 09:00–17:00". */
export function formatScheduleSummary(schedule: TimeSchedule, locale?: string): string {
  const start = formatScheduleTime(schedule.startTime, locale);
  const end = formatScheduleTime(schedule.endTime, locale);
  // Times that carry AM/PM contain a space, so the dash between them is spaced to match. None of
  // these spaces break, so a narrow line wraps between the days and the hours, never inside them.
  const isSpaced = start.includes(NO_BREAK_SPACE) || end.includes(NO_BREAK_SPACE);
  const dash = isSpaced ? `${NO_BREAK_SPACE}–${NO_BREAK_SPACE}` : '–';
  return `${formatScheduleDays(schedule.daysOfWeek)} ${start}${dash}${end}`;
}

/**
 * A stored HH:MM schedule time on the reader's clock: "9:00 AM" where the locale uses a 12-hour
 * clock, and the stored "09:00" where it uses a 24-hour one. The schedule editor's time inputs and
 * the "until 3:45 PM" texts already follow the locale, so a schedule reads the way it was entered.
 * Anything that is not a real time is shown as stored.
 */
export function formatScheduleTime(time: string, locale?: string): string {
  if (!isValidTimeString(time)) {
    return time;
  }

  const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const { hourCycle } = formatter.resolvedOptions();
  if (hourCycle !== 'h11' && hourCycle !== 'h12') {
    return time;
  }

  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return formatter.format(new Date(2000, 0, 1, hours, minutes)).replace(/\s/g, NO_BREAK_SPACE);
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
