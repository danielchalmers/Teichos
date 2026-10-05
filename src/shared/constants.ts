/**
 * Shared constants used across the extension
 */

export const EXTENSION_NAME = 'Teichos' as const;

export const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Spoken names for DAY_NAMES; each starts with its abbreviation so the visible label stays in the name. */
export const DAY_FULL_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DEFAULT_SCHEDULE = {
  daysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
  startTime: '09:00',
  endTime: '17:00',
} as const;

export const PAGES = {
  BLOCKED: 'blocked.html',
  OPTIONS: 'options.html',
  POPUP: 'popup.html',
} as const;

export const ALARMS = {
  SNOOZE_EXPIRATION: 'snooze-expiration',
  RULES_CHANGE: 'rules-change',
} as const;
