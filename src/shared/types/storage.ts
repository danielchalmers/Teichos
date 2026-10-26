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
  readonly enabled?: boolean;
}

/**
 * URL matching modes for filters and whitelist entries. `domain` matches a site and its
 * subdomains by host; `contains` matches text anywhere in the address.
 */
export type FilterMatchMode = 'domain' | 'contains' | 'exact' | 'regex';

/** URL filter pattern */
export interface Filter {
  readonly id: string;
  readonly pattern: string;
  readonly groupId: string;
  readonly enabled: boolean;
  readonly matchMode: FilterMatchMode;
  readonly description?: string;
  readonly expiresAt?: number; // Epoch ms when a temporary filter expires
}

/** Whitelist entry scoped to a filter group */
export interface Whitelist {
  readonly id: string;
  readonly pattern: string;
  readonly groupId: string;
  readonly enabled: boolean;
  readonly matchMode: FilterMatchMode;
  readonly description?: string;
}

/** Global snooze state for temporarily pausing all filtering */
export interface SnoozeState {
  readonly active: boolean;
  readonly until?: number; // Epoch ms when snooze expires; omitted means "Always"
}

export interface BlockedBy {
  readonly filterId: string;
  readonly groupId: string;
  /** Other filters that also blocked the target, so Continue anyway passes them in one step. */
  readonly otherFilterIds?: readonly string[];
}

export interface BlockedTabState {
  readonly blockId: string;
  readonly tabId: number;
  readonly targetUrl: string;
  readonly blockedBy: BlockedBy;
  readonly blockedAt: number;
}

export interface BlockedFilterSnapshot {
  readonly id: string;
  readonly pattern: string;
  readonly matchMode: FilterMatchMode;
  readonly description?: string;
  readonly expiresAt?: number; // Epoch ms when the temporary filter that caused the block expires
}

export type BlockedGroupSnapshot = FilterGroup;

export interface BlockedEffectiveState {
  readonly filterEnabled: boolean;
  readonly groupActive: boolean;
  readonly snoozeActive: boolean;
}

export interface BlockedPageState extends BlockedTabState {
  readonly filter: BlockedFilterSnapshot;
  /** Snapshots of `blockedBy.otherFilterIds`, so the block page names every filter it passes. */
  readonly otherFilters?: readonly BlockedFilterSnapshot[];
  readonly group: BlockedGroupSnapshot | undefined;
  readonly effectiveState: BlockedEffectiveState;
}

/**
 * Per-tab record of the filters the user chose to continue past. Each one stays bypassed in that
 * tab until the tab closes, so continuing once doesn't mean clicking through every later page.
 */
export interface BypassState {
  readonly filterIds: readonly string[];
}

/** Root storage schema */
export interface StorageData {
  readonly groups: readonly FilterGroup[];
  readonly filters: readonly Filter[];
  readonly whitelist: readonly Whitelist[];
  readonly snooze: SnoozeState;
  readonly expandBlockPageDetails?: boolean;
  readonly rulesVersion: number;
  /**
   * Which one-time migrations the data has been through (see `CURRENT_SCHEMA_VERSION`). Data
   * from before the field existed is version 1.
   */
  readonly schemaVersion: number;
}

/**
 * 2: hostname-only "contains" patterns became domain patterns, when domain matching was added.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** Default group ID constant */
export const DEFAULT_GROUP_ID = 'default-24x7' as const;

/** Storage key constant */
export const STORAGE_KEY = 'pageblock_data' as const;
