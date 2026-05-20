import { DAY_NAMES } from '../constants';
import type { FilterGroup, TimeSchedule } from '../types';

export function formatGroupScheduleSummary(group: FilterGroup): string {
  if (group.enabled === false) {
    return 'Disabled';
  }

  if (group.is24x7) {
    return 'Always Active';
  }

  if (group.schedules.length === 0) {
    return '0 schedules';
  }

  return group.schedules.map(formatScheduleSummary).join(', ');
}

export function formatScheduleSummary(schedule: TimeSchedule): string {
  return `${formatScheduleDays(schedule.daysOfWeek)} ${schedule.startTime}-${schedule.endTime}`;
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

  return `${DAY_NAMES[startDay] ?? 'Unknown'}-${DAY_NAMES[endDay] ?? 'Unknown'}`;
}
