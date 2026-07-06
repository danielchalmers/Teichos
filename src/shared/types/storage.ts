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

/** URL matching modes for filters and whitelist entries */
export type FilterMatchMode = 'contains' | 'exact' | 'regex';

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
}

export type BlockedGroupSnapshot = FilterGroup;

export interface BlockedEffectiveState {
  readonly filterEnabled: boolean;
  readonly groupActive: boolean;
  readonly snoozeActive: boolean;
}

export interface BlockedPageState extends BlockedTabState {
  readonly filter: BlockedFilterSnapshot;
  readonly group: BlockedGroupSnapshot | undefined;
  readonly effectiveState: BlockedEffectiveState;
}

/** Per-tab record of a block the user chose to continue past. */
export interface BypassState {
  readonly filterId: string;
  readonly urlKey: string;
}

/** Root storage schema */
export interface StorageData {
  readonly groups: readonly FilterGroup[];
  readonly filters: readonly Filter[];
  readonly whitelist: readonly Whitelist[];
  readonly snooze: SnoozeState;
  readonly expandBlockPageDetails?: boolean;
  readonly rulesVersion: number;
}

/** Default group ID constant */
export const DEFAULT_GROUP_ID = 'default-24x7' as const;

/** Storage key constant */
export const STORAGE_KEY = 'pageblock_data' as const;
