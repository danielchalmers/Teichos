import { describe, expect, it } from 'vitest';
import {
  formatGroupScheduleSummary,
  formatScheduleDays,
  formatScheduleSummary,
  formatScheduleTime,
  formatSnoozeEnd,
  formatTemporaryFilterLabel,
  formatUntil,
} from '../../../src/shared/utils/schedules';

describe('formatScheduleDays', () => {
  it('returns no days when the schedule has no active days', () => {
    expect(formatScheduleDays([])).toBe('No days');
  });

  it('formats a single day', () => {
    expect(formatScheduleDays([6])).toBe('Sat');
  });

  it('formats consecutive day ranges', () => {
    expect(formatScheduleDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
  });

  it('formats non-consecutive days and ranges', () => {
    expect(formatScheduleDays([0, 2, 3, 5])).toBe('Sun, Tue–Wed, Fri');
  });

  it('formats all days as daily', () => {
    expect(formatScheduleDays([0, 1, 2, 3, 4, 5, 6])).toBe('Daily');
  });
});

// ICU versions differ on whether the space before AM/PM is a narrow no-break space, and the dash
// between two such times is set with no-break spaces, so spaces are normalized before comparing.
const plainSpaces = (text: string): string => text.replace(/\s+/g, ' ');

describe('formatScheduleTime', () => {
  it('uses a 12-hour clock where the locale does', () => {
    expect(plainSpaces(formatScheduleTime('09:00', 'en-US'))).toBe('9:00 AM');
    expect(plainSpaces(formatScheduleTime('17:30', 'en-US'))).toBe('5:30 PM');
    expect(plainSpaces(formatScheduleTime('00:00', 'en-US'))).toBe('12:00 AM');
    expect(plainSpaces(formatScheduleTime('12:00', 'en-US'))).toBe('12:00 PM');
  });

  it('uses a 24-hour clock where the locale does', () => {
    expect(formatScheduleTime('09:00', 'en-GB')).toBe('09:00');
    expect(formatScheduleTime('17:30', 'de-DE')).toBe('17:30');
    expect(formatScheduleTime('00:00', 'en-GB')).toBe('00:00');
  });

  it('shows a value that is not a time as it is stored', () => {
    expect(formatScheduleTime('', 'en-US')).toBe('');
    expect(formatScheduleTime('25:00', 'en-US')).toBe('25:00');
  });
});

describe('formatScheduleSummary', () => {
  const workHours = { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' };

  it('combines the formatted day label with the time range', () => {
    expect(plainSpaces(formatScheduleSummary(workHours, 'en-US'))).toBe(
      'Mon–Fri 9:00 AM – 5:00 PM'
    );
  });

  it('keeps a 24-hour range compact', () => {
    expect(formatScheduleSummary(workHours, 'en-GB')).toBe('Mon–Fri 09:00–17:00');
  });

  it('keeps a 12-hour range on one line', () => {
    // Only the space after the days can break, so a narrow line never splits the hours.
    expect(formatScheduleSummary(workHours, 'en-US').split(' ')).toHaveLength(2);
  });

  it('formats a range that crosses midnight', () => {
    expect(
      plainSpaces(
        formatScheduleSummary({ daysOfWeek: [5, 6], startTime: '23:00', endTime: '07:30' }, 'en-US')
      )
    ).toBe('Fri–Sat 11:00 PM – 7:30 AM');
  });
});

describe('formatGroupScheduleSummary', () => {
  it('returns always active for 24/7 groups', () => {
    expect(
      formatGroupScheduleSummary({
        id: 'default-24x7',
        name: '24/7',
        is24x7: true,
        schedules: [],
      })
    ).toBe('Always active');
  });

  it('says there is no schedule when a custom group has no schedules', () => {
    expect(
      formatGroupScheduleSummary({
        id: 'custom-group',
        name: 'Custom',
        is24x7: false,
        schedules: [],
      })
    ).toBe('No schedule');
  });

  it('joins multiple schedule hints for a custom group', () => {
    const group = {
      id: 'work-hours',
      name: 'Work Hours',
      is24x7: false,
      schedules: [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
        { daysOfWeek: [6], startTime: '10:00', endTime: '12:00' },
      ],
    };
    expect(plainSpaces(formatGroupScheduleSummary(group, 'en-US'))).toBe(
      'Mon–Fri 9:00 AM – 5:00 PM; Sat 10:00 AM – 12:00 PM'
    );
    expect(formatGroupScheduleSummary(group, 'en-GB')).toBe('Mon–Fri 09:00–17:00; Sat 10:00–12:00');
  });
});

describe('formatSnoozeEnd', () => {
  // Local-time constructors keep these independent of the machine's time zone, and ICU versions
  // differ on whether the space before AM/PM is a narrow no-break space, so spaces are normalized.
  const now = new Date(2026, 9, 5, 14, 0).getTime();
  const format = (until?: number): string =>
    formatSnoozeEnd(
      until === undefined ? { active: true } : { active: true, until },
      now,
      'en-US'
    ).replace(/\s+/g, ' ');

  it('describes a snooze without an end as lasting until resumed', () => {
    expect(format()).toBe('until you resume it');
  });

  it('gives only the time when the snooze ends today', () => {
    const until = new Date(2026, 9, 5, 15, 45).getTime();
    expect(format(until)).toBe('until 3:45 PM');
  });

  it('adds the weekday when the snooze ends on another day', () => {
    const until = new Date(2026, 9, 6, 9, 5).getTime();
    expect(format(until)).toBe('until Tue 9:05 AM');
  });

  it('adds the weekday up to six calendar days ahead', () => {
    const until = new Date(2026, 9, 11, 23, 59).getTime();
    expect(format(until)).toBe('until Sun 11:59 PM');
  });

  it('adds the date when the snooze ends a week or more away', () => {
    expect(format(new Date(2026, 9, 12, 0, 30).getTime())).toBe('until Oct 12, 12:30 AM');
    expect(format(new Date(2026, 9, 14, 9, 0).getTime())).toBe('until Oct 14, 9:00 AM');
  });
});

describe('formatUntil', () => {
  it('does not throw for a time beyond the Date range', () => {
    expect(formatUntil(8.64e15 + 1)).toBe('until further notice');
  });
});

describe('formatTemporaryFilterLabel', () => {
  it('shows the time left', () => {
    expect(formatTemporaryFilterLabel(45 * 60_000)).toBe('Temporary · 45m left');
    expect(formatTemporaryFilterLabel(2 * 3_600_000)).toBe('Temporary · 2h left');
    expect(formatTemporaryFilterLabel(3 * 86_400_000)).toBe('Temporary · 3d left');
  });

  it('says when the time is up', () => {
    expect(formatTemporaryFilterLabel(0)).toBe('Temporary · expired');
    expect(formatTemporaryFilterLabel(-5_000)).toBe('Temporary · expired');
  });
});
