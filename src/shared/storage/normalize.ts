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
import { isObject, isValidSchedule } from './guards';

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

/**
 * Trim surrounding whitespace so a pasted pattern still matches. Regex patterns are left exactly
 * as written, since whitespace there can be a deliberate part of the expression.
 */
function normalizePattern(pattern: string, matchMode: FilterMatchMode): string {
  return matchMode === 'regex' ? pattern : pattern.trim();
}

/**
 * A blank pattern matches every URL, so a blank filter blocks the whole web and a blank exception
 * disables every filter in its group. Neither is recoverable into something the user meant, so
 * drop the entry rather than let it silently take over.
 */
function hasUsablePattern(entry: unknown): entry is { readonly pattern: string } {
  return isObject(entry) && typeof entry['pattern'] === 'string' && entry['pattern'].trim() !== '';
}

/**
 * Synced data is not validated like an import: it can come from another device, an older build,
 * or a manual edit. Treat a non-array list as empty rather than throwing on every load.
 */
function asArray<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeFilters(
  filters: readonly LegacyFilter[] | undefined,
  groupIds: ReadonlySet<string>
): Filter[] {
  // blockType is a retired per-filter setting; strip it from legacy data.
  // A groupId whose group no longer exists would make the filter silently
  // inactive, so reassign it to the default group like whitelist entries.
  return asArray(filters)
    .filter(hasUsablePattern)
    .map(({ isRegex, matchMode, blockType: _blockType, ...filter }) => {
      const resolvedMatchMode = resolveMatchMode(matchMode, isRegex);
      return {
        ...filter,
        pattern: normalizePattern(filter.pattern, resolvedMatchMode),
        groupId: groupIds.has(filter.groupId) ? filter.groupId : DEFAULT_GROUP_ID,
        matchMode: resolvedMatchMode,
      };
    });
}

function normalizeWhitelist(
  whitelist: readonly LegacyWhitelist[] | undefined,
  groupIds: ReadonlySet<string>
): Whitelist[] {
  return asArray(whitelist)
    .filter(hasUsablePattern)
    .map(({ isRegex, matchMode, groupId, ...entry }) => {
      const resolvedMatchMode = resolveMatchMode(matchMode, isRegex);
      return {
        ...entry,
        pattern: normalizePattern(entry.pattern, resolvedMatchMode),
        groupId: groupId && groupIds.has(groupId) ? groupId : DEFAULT_GROUP_ID,
        matchMode: resolvedMatchMode,
      };
    });
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

/**
 * Repair the group fields that schedule evaluation and the options page index into. A single
 * malformed group (e.g. `schedules: null`) otherwise throws on every navigation, so filtering
 * fails open, and keeps the options page from loading at all. Invalid schedule entries are
 * dropped, which leaves a scheduled group inactive rather than guessing at its hours.
 */
function normalizeGroups(groups: readonly FilterGroup[] | undefined): FilterGroup[] {
  const usableGroups = asArray(groups).filter(
    (group) => isObject(group) && typeof group.id === 'string'
  );
  return (usableGroups.length > 0 ? usableGroups : [createDefaultGroup()]).map((group) => ({
    ...group,
    name: typeof group.name === 'string' ? group.name : '',
    is24x7: group.is24x7 === true,
    schedules: asArray(group.schedules).filter(isValidSchedule),
    enabled: typeof group.enabled === 'boolean' ? group.enabled : true,
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
