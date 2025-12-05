/**
 * Shared constants used across the extension
 */

export const EXTENSION_NAME = 'Teichos' as const;

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

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
