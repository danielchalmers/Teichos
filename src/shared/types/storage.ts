/**
 * Storage schema types for chrome.storage
 * All data structures stored in extension storage
 */

/** Time schedule for filter groups */
export interface TimeSchedule {
  readonly daysOfWeek: readonly number[]; // 0-6, Sunday-Saturday
  readonly startTime: string; // HH:MM format
  readonly endTime: string; // HH:MM format
}

/** Mutable version of TimeSchedule for internal editing */
export interface MutableTimeSchedule {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

/** Filter group with optional time-based scheduling */
export interface FilterGroup {
  readonly id: string;
  readonly name: string;
  readonly schedules: readonly TimeSchedule[];
  readonly is24x7: boolean;
}

/** URL filter pattern */
export interface Filter {
  readonly id: string;
  readonly pattern: string;
  readonly groupId: string;
  readonly enabled: boolean;
  readonly description?: string;
  readonly isRegex?: boolean;
}

/** Whitelist entry - URLs matching these patterns are never blocked */
export interface Whitelist {
  readonly id: string;
  readonly pattern: string;
  readonly enabled: boolean;
  readonly description?: string;
  readonly isRegex?: boolean;
}

/** Root storage schema */
export interface StorageData {
  readonly groups: readonly FilterGroup[];
  readonly filters: readonly Filter[];
  readonly whitelist: readonly Whitelist[];
}

/** Default group ID constant */
export const DEFAULT_GROUP_ID = 'default-24x7' as const;

/** Storage key constant */
export const STORAGE_KEY = 'pageblock_data' as const;
