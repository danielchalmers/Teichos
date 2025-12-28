/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type { StorageData, FilterGroup, Filter, FilterMatchMode, Whitelist } from '../types';
import { STORAGE_KEY, DEFAULT_GROUP_ID } from '../types';

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

  const data = storedData as StorageData;
  const groupIds = new Set(data.groups.map((group) => group.id));
  const filters = normalizeFilters(data.filters as LegacyFilter[] | undefined);
  const whitelist = normalizeWhitelist(data.whitelist as LegacyWhitelist[] | undefined, groupIds);

  return {
    ...data,
    filters,
    whitelist,
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
