/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type {
  StorageData,
  FilterGroup,
  Filter,
  FilterMatchMode,
  Whitelist,
  SnoozeState,
} from '../types';
import { STORAGE_KEY, DEFAULT_GROUP_ID } from '../types';
import { setSessionSnooze } from './session';

/**
 * Creates the default 24/7 filter group
 */
export function createDefaultGroup(): FilterGroup {
  return {
    id: DEFAULT_GROUP_ID,
    name: '24/7 (Always Active)',
    schedules: [],
    is24x7: true,
  };
}

/**
 * Creates empty default storage data
 */
function createDefaultData(): StorageData {
  return {
    groups: [createDefaultGroup()],
    filters: [],
    whitelist: [],
    snooze: { active: false },
  };
}

type LegacyFilter = Omit<Filter, 'matchMode'> & {
  readonly matchMode?: FilterMatchMode;
  readonly isRegex?: boolean;
};

type LegacyWhitelist = Omit<Whitelist, 'matchMode' | 'groupId'> & {
  readonly matchMode?: FilterMatchMode;
  readonly isRegex?: boolean;
  readonly groupId?: string;
};

type LegacyStorageData = {
  readonly groups?: readonly FilterGroup[];
  readonly filters?: readonly LegacyFilter[];
  readonly whitelist?: readonly LegacyWhitelist[];
  readonly snooze?: {
    readonly active?: boolean;
    readonly until?: number;
  };
};

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
  return (filters ?? []).map(({ isRegex, matchMode, ...filter }) => ({
    ...filter,
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

/**
 * Load storage data from chrome.storage.sync
 * Creates default data if none exists
 */
export async function loadData(): Promise<StorageData> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const storedData = result[STORAGE_KEY];

  if (!storedData) {
    const defaultData = createDefaultData();
    await saveData(defaultData);
    return defaultData;
  }

  const data = storedData as LegacyStorageData;
  const groups =
    data.groups && data.groups.length > 0 ? data.groups : [createDefaultGroup()];
  const groupIds = new Set(groups.map((group) => group.id));
  const filters = normalizeFilters(data.filters);
  const whitelist = normalizeWhitelist(data.whitelist, groupIds);
  const snooze = normalizeSnooze(data.snooze);

  return {
    ...data,
    groups,
    filters,
    whitelist,
    snooze,
  };
}

/**
 * Save storage data to chrome.storage.sync
 */
export async function saveData(data: StorageData): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: data });
}

// Group operations

export async function addGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  await saveData({
    ...data,
    groups: [...data.groups, group],
  });
}

export async function updateGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  const index = data.groups.findIndex((g) => g.id === group.id);

  if (index !== -1) {
    const newGroups = [...data.groups];
    newGroups[index] = group;
    await saveData({ ...data, groups: newGroups });
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  if (groupId === DEFAULT_GROUP_ID) {
    throw new Error('Cannot delete the default 24/7 group');
  }

  const data = await loadData();
  await saveData({
    ...data,
    groups: data.groups.filter((g) => g.id !== groupId),
    // Move filters from deleted group to default group
    filters: data.filters.map((f) =>
      f.groupId === groupId ? { ...f, groupId: DEFAULT_GROUP_ID } : f
    ),
    whitelist: data.whitelist.map((entry) =>
      entry.groupId === groupId ? { ...entry, groupId: DEFAULT_GROUP_ID } : entry
    ),
  });
}

// Filter operations

export async function addFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  await saveData({
    ...data,
    filters: [...data.filters, filter],
  });
}

export async function updateFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  const index = data.filters.findIndex((f) => f.id === filter.id);

  if (index !== -1) {
    const newFilters = [...data.filters];
    newFilters[index] = filter;
    await saveData({ ...data, filters: newFilters });
  }
}

export async function deleteFilter(filterId: string): Promise<void> {
  const data = await loadData();
  await saveData({
    ...data,
    filters: data.filters.filter((f) => f.id !== filterId),
  });
}

// Whitelist operations

export async function addWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  await saveData({
    ...data,
    whitelist: [...data.whitelist, whitelist],
  });
}

export async function updateWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  const index = data.whitelist.findIndex((w) => w.id === whitelist.id);

  if (index !== -1) {
    const newWhitelist = [...data.whitelist];
    newWhitelist[index] = whitelist;
    await saveData({ ...data, whitelist: newWhitelist });
  }
}

export async function deleteWhitelist(whitelistId: string): Promise<void> {
  const data = await loadData();
  await saveData({
    ...data,
    whitelist: data.whitelist.filter((w) => w.id !== whitelistId),
  });
}

export async function setSnooze(snooze: SnoozeState): Promise<void> {
  const data = await loadData();
  await Promise.all([
    saveData({
      ...data,
      snooze,
    }),
    setSessionSnooze(snooze),
  ]);
}

export async function clearSnooze(): Promise<void> {
  await setSnooze({ active: false });
}
