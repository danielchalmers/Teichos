import { describe, expect, it } from 'vitest';
import {
  formatGroupScheduleSummary,
  formatScheduleDays,
  formatScheduleSummary,
} from '../../../src/shared/utils/schedules';

describe('formatScheduleDays', () => {
  it('returns no days when the schedule has no active days', () => {
    expect(formatScheduleDays([])).toBe('No days');
  });

  it('formats a single day', () => {
    expect(formatScheduleDays([6])).toBe('Sa');
  });

  it('formats consecutive day ranges', () => {
    expect(formatScheduleDays([1, 2, 3, 4, 5])).toBe('Mo-Fr');
  });

  it('formats non-consecutive days and ranges', () => {
    expect(formatScheduleDays([0, 2, 3, 5])).toBe('Su, Tu-We, Fr');
  });

  it('formats all days as daily', () => {
    expect(formatScheduleDays([0, 1, 2, 3, 4, 5, 6])).toBe('Daily');
  });
});

describe('formatScheduleSummary', () => {
  it('combines the formatted day label with the time range', () => {
    expect(
      formatScheduleSummary({
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      })
    ).toBe('Mo-Fr 09:00-17:00');
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
    ).toBe('Always Active');
  });

  it('falls back to a schedule count when a custom group has no schedules', () => {
    expect(
      formatGroupScheduleSummary({
        id: 'custom-group',
        name: 'Custom',
        is24x7: false,
        schedules: [],
      })
    ).toBe('0 schedules');
  });

  it('joins multiple schedule hints for a custom group', () => {
    expect(
      formatGroupScheduleSummary({
        id: 'work-hours',
        name: 'Work Hours',
        is24x7: false,
        schedules: [
          { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
          { daysOfWeek: [6], startTime: '10:00', endTime: '12:00' },
        ],
      })
    ).toBe('Mo-Fr 09:00-17:00, Sa 10:00-12:00');
  });
});
