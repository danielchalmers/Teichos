/**
 * Shared utility functions
 */

import { DAY_NAMES } from '../constants';
import type { FilterGroup, TimeSchedule } from '../types';

const INTERNAL_URL_PREFIXES = [
  'chrome-extension://',
  'chrome://',
  'chrome-untrusted://',
  'chrome-search://',
  'devtools://',
  'edge://',
  'edge-extension://',
  'edge-devtools://',
  'about:',
  'moz-extension://',
  'safari-extension://',
  'opera://',
  'brave://',
  'vivaldi://',
  'extension://',
  'view-source:',
] as const;

/**
 * Generate a unique ID
 * Uses crypto.randomUUID() if available, otherwise fallback
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}

/**
 * Format time as HH:MM
 */
export function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get current time as HH:MM string
 */
export function getCurrentTimeString(): string {
  const now = new Date();
  return formatTime(now.getHours(), now.getMinutes());
}

/**
 * Format a duration in milliseconds into a compact label.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
}

/**
 * Get current day of week (0-6, Sunday-Saturday)
 */
export function getCurrentDayOfWeek(): number {
  return new Date().getDay();
}

/**
 * Format selected days of the week into a compact label.
 */
export function formatScheduleDays(daysOfWeek: readonly number[]): string {
  if (daysOfWeek.length === 0) {
    return 'No days';
  }

  const days = [...new Set(daysOfWeek)]
    .filter((day) => day >= 0 && day < DAY_NAMES.length)
    .sort((a, b) => a - b);
  if (days.length === 0) {
    return 'No days';
  }

  const ranges: string[] = [];
  let rangeStart = days[0] as number;
  let rangeEnd = rangeStart;

  for (const day of days.slice(1)) {
    if (day === rangeEnd + 1) {
      rangeEnd = day;
      continue;
    }

    ranges.push(
      rangeStart === rangeEnd
        ? DAY_NAMES[rangeStart] ?? ''
        : `${DAY_NAMES[rangeStart] ?? ''}–${DAY_NAMES[rangeEnd] ?? ''}`
    );
    rangeStart = day;
    rangeEnd = day;
  }

  ranges.push(
    rangeStart === rangeEnd
      ? DAY_NAMES[rangeStart] ?? ''
      : `${DAY_NAMES[rangeStart] ?? ''}–${DAY_NAMES[rangeEnd] ?? ''}`
  );

  return ranges.join(', ');
}

/**
 * Format a single schedule into a compact label.
 */
export function formatScheduleSummary(schedule: TimeSchedule): string {
  return `${formatScheduleDays(schedule.daysOfWeek)} ${schedule.startTime}–${schedule.endTime}`;
}

/**
 * Format a filter group's schedule summary for display.
 */
export function formatGroupScheduleSummary(
  group: Pick<FilterGroup, 'is24x7' | 'schedules'>
): string {
  if (group.is24x7) {
    return 'Always Active';
  }

  if (group.schedules.length === 0) {
    return 'No schedules';
  }

  return group.schedules.map((schedule) => formatScheduleSummary(schedule)).join('; ');
}

/**
 * Check if a URL is a browser/internal page that should not be filtered
 */
export function isInternalUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  const normalizedUrl = url.toLowerCase();
  return INTERNAL_URL_PREFIXES.some((prefix) => normalizedUrl.startsWith(prefix));
}
