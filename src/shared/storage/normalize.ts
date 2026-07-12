import type {
  Filter,
  FilterGroup,
  FilterMatchMode,
  SnoozeState,
  StorageData,
  Whitelist,
} from '../types';
import { DEFAULT_GROUP_ID } from '../types';
import { createDefaultData, createDefaultGroup } from './defaults';

export type LegacyFilter = Omit<Filter, 'matchMode'> & {
  readonly matchMode?: FilterMatchMode;
  readonly blockType?: string;
  readonly isRegex?: boolean;
};

export type LegacyWhitelist = Omit<Whitelist, 'matchMode' | 'groupId'> & {
  readonly matchMode?: FilterMatchMode;
  readonly isRegex?: boolean;
  readonly groupId?: string;
};

export interface LegacyStorageData {
  readonly groups?: readonly FilterGroup[];
  readonly filters?: readonly LegacyFilter[];
  readonly whitelist?: readonly LegacyWhitelist[];
  readonly rulesVersion?: number;
  readonly blockType?: string;
  readonly expandBlockPageDetails?: boolean;
  readonly snooze?: {
    readonly active?: boolean;
    readonly until?: number;
  };
}

function resolveMatchMode(
  matchMode: FilterMatchMode | undefined,
  isRegex?: boolean
): FilterMatchMode {
  if (matchMode === 'contains' || matchMode === 'exact' || matchMode === 'regex') {
    return matchMode;
  }
  return isRegex ? 'regex' : 'contains';
}

function normalizeFilters(
  filters: readonly LegacyFilter[] | undefined,
  groupIds: ReadonlySet<string>
): Filter[] {
  // blockType is a retired per-filter setting; strip it from legacy data.
  // A groupId whose group no longer exists would make the filter silently
  // inactive, so reassign it to the default group like whitelist entries.
  return (filters ?? []).map(({ isRegex, matchMode, blockType: _blockType, ...filter }) => ({
    ...filter,
    groupId: groupIds.has(filter.groupId) ? filter.groupId : DEFAULT_GROUP_ID,
    matchMode: resolveMatchMode(matchMode, isRegex),
  }));
}

function normalizeWhitelist(
  whitelist: readonly LegacyWhitelist[] | undefined,
  groupIds: ReadonlySet<string>
): Whitelist[] {
  return (whitelist ?? []).map(({ isRegex, matchMode, groupId, ...entry }) => ({
    ...entry,
    groupId: groupId && groupIds.has(groupId) ? groupId : DEFAULT_GROUP_ID,
    matchMode: resolveMatchMode(matchMode, isRegex),
  }));
}

function normalizeSnooze(snooze: LegacyStorageData['snooze']): SnoozeState {
  if (!snooze?.active) {
    return { active: false };
  }

  if (typeof snooze.until === 'number' && Number.isFinite(snooze.until)) {
    return { active: true, until: snooze.until };
  }

  return { active: true };
}

function normalizeGroups(groups: readonly FilterGroup[] | undefined): FilterGroup[] {
  return (groups && groups.length > 0 ? groups : [createDefaultGroup()]).map((group) => ({
    ...group,
    enabled: group.enabled ?? true,
  }));
}

export function normalizeStoredData(raw: LegacyStorageData | undefined): StorageData {
  if (!raw) {
    return createDefaultData();
  }

  const normalizedGroups = normalizeGroups(raw.groups);
  const groupIds = new Set(normalizedGroups.map((group) => group.id));
  const filters = normalizeFilters(raw.filters, groupIds);
  const whitelist = normalizeWhitelist(raw.whitelist, groupIds);
  // Reassignment targets the default group, so make sure it exists when needed.
  const needsDefaultGroup =
    !groupIds.has(DEFAULT_GROUP_ID) &&
    (filters.some((filter) => filter.groupId === DEFAULT_GROUP_ID) ||
      whitelist.some((entry) => entry.groupId === DEFAULT_GROUP_ID));
  const groups = needsDefaultGroup ? [createDefaultGroup(), ...normalizedGroups] : normalizedGroups;
  const snooze = normalizeSnooze(raw.snooze);
  const rulesVersion =
    typeof raw.rulesVersion === 'number' && Number.isFinite(raw.rulesVersion)
      ? raw.rulesVersion
      : 0;
  const expandBlockPageDetails = raw.expandBlockPageDetails === true;

  return {
    groups,
    filters,
    whitelist,
    snooze,
    expandBlockPageDetails,
    rulesVersion,
  };
}
