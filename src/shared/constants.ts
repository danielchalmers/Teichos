/**
 * Shared constants used across the extension
 */

export const EXTENSION_NAME = 'Teichos' as const;

export const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export const DEFAULT_SCHEDULE = {
  daysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
  startTime: '09:00',
  endTime: '17:00',
} as const;

export const PAGES = {
  BLOCKED: 'blocked/index.html',
  OPTIONS: 'options/index.html',
  POPUP: 'popup/index.html',
} as const;

export const ALARMS = {
  SNOOZE_EXPIRATION: 'snooze-expiration',
} as const;
