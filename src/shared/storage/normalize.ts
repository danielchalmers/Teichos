import type {
  BlockType,
  Filter,
  FilterBlockType,
  FilterGroup,
  FilterMatchMode,
  SnoozeState,
  StorageData,
  Whitelist,
} from '../types';
import { DEFAULT_GROUP_ID } from '../types';
import { createDefaultData, createDefaultGroup } from './defaults';
import { isValidBlockType, isValidFilterBlockType } from './guards';

export type LegacyFilter = Omit<Filter, 'matchMode'> & {
  readonly matchMode?: FilterMatchMode;
  readonly blockType?: FilterBlockType;
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
  readonly blockType?: BlockType;
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

function normalizeFilters(filters: readonly LegacyFilter[] | undefined): Filter[] {
  return (filters ?? []).map(({ isRegex, matchMode, blockType, ...filter }) => ({
    ...filter,
    matchMode: resolveMatchMode(matchMode, isRegex),
    blockType: isValidFilterBlockType(blockType) ? blockType : 'default',
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

  const groups = normalizeGroups(raw.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const filters = normalizeFilters(raw.filters);
  const whitelist = normalizeWhitelist(raw.whitelist, groupIds);
  const snooze = normalizeSnooze(raw.snooze);
  const rulesVersion =
    typeof raw.rulesVersion === 'number' && Number.isFinite(raw.rulesVersion)
      ? raw.rulesVersion
      : 0;
  const blockType = isValidBlockType(raw.blockType) ? raw.blockType : 'block';
  const expandBlockPageDetails = raw.expandBlockPageDetails === true;

  return {
    groups,
    filters,
    whitelist,
    snooze,
    blockType,
    expandBlockPageDetails,
    rulesVersion,
  };
}
