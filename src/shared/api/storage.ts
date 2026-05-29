/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type { StorageData, FilterGroup, Filter, Whitelist, SnoozeState } from '../types';
import { STORAGE_KEY, DEFAULT_GROUP_ID } from '../types';
import { parseImportedData, serializeDataForExport } from '../storage/importExport';
import { normalizeStoredData, type LegacyStorageData } from '../storage/normalize';
import { createDefaultGroup } from '../storage/defaults';
import { setSessionSnooze } from './session';

export { createDefaultGroup };
export { normalizeStoredData };
export { serializeDataForExport, parseImportedData };

/**
 * Load storage data from chrome.storage.sync
 */
export async function loadData(): Promise<StorageData> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return normalizeStoredData(result[STORAGE_KEY] as LegacyStorageData | undefined);
}

export async function exportData(): Promise<string> {
  return serializeDataForExport(await loadData());
}

/**
 * Save storage data to chrome.storage.sync
 */
export async function saveData(data: StorageData): Promise<void> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const storedData = result[STORAGE_KEY] as { rulesVersion?: unknown } | undefined;
  const previousRulesVersion =
    typeof storedData?.rulesVersion === 'number' && Number.isFinite(storedData.rulesVersion)
      ? storedData.rulesVersion
      : typeof data.rulesVersion === 'number' && Number.isFinite(data.rulesVersion)
        ? data.rulesVersion
        : 0;

  await chrome.storage.sync.set({
    [STORAGE_KEY]: {
      ...data,
      rulesVersion: previousRulesVersion + 1,
    },
  });
}

async function updateData(updater: (data: StorageData) => StorageData): Promise<StorageData> {
  const data = await loadData();
  const updatedData = updater(data);

  if (updatedData !== data) {
    await saveData(updatedData);
  }

  return updatedData;
}

export async function importData(serialized: string): Promise<StorageData> {
  const data = parseImportedData(serialized);
  await Promise.all([saveData(data), setSessionSnooze(data.snooze)]);
  return data;
}

// Group operations

export async function addGroup(group: FilterGroup): Promise<void> {
  await updateData((data) => ({
    ...data,
    groups: [...data.groups, group],
  }));
}

export async function updateGroup(group: FilterGroup): Promise<void> {
  await updateData((data) => {
    const index = data.groups.findIndex((g) => g.id === group.id);

    if (index === -1) {
      return data;
    }

    const newGroups = [...data.groups];
    newGroups[index] = group;
    return { ...data, groups: newGroups };
  });
}

export async function deleteGroup(groupId: string): Promise<void> {
  if (groupId === DEFAULT_GROUP_ID) {
    throw new Error('Cannot delete the default 24/7 group');
  }

  await updateData((data) => ({
    ...data,
    groups: data.groups.filter((g) => g.id !== groupId),
    filters: data.filters.map((f) => (f.groupId === groupId ? { ...f, groupId: DEFAULT_GROUP_ID } : f)),
    whitelist: data.whitelist.map((entry) =>
      entry.groupId === groupId ? { ...entry, groupId: DEFAULT_GROUP_ID } : entry
    ),
  }));
}

// Filter operations

export async function addFilter(filter: Filter): Promise<void> {
  await updateData((data) => ({
    ...data,
    filters: [...data.filters, filter],
  }));
}

export async function updateFilter(filter: Filter): Promise<void> {
  await updateData((data) => {
    const index = data.filters.findIndex((f) => f.id === filter.id);

    if (index === -1) {
      return data;
    }

    const newFilters = [...data.filters];
    newFilters[index] = filter;
    return { ...data, filters: newFilters };
  });
}

export async function deleteFilter(filterId: string): Promise<void> {
  await updateData((data) => ({
    ...data,
    filters: data.filters.filter((f) => f.id !== filterId),
  }));
}

// Whitelist operations

export async function addWhitelist(whitelist: Whitelist): Promise<void> {
  await updateData((data) => ({
    ...data,
    whitelist: [...data.whitelist, whitelist],
  }));
}

export async function updateWhitelist(whitelist: Whitelist): Promise<void> {
  await updateData((data) => {
    const index = data.whitelist.findIndex((w) => w.id === whitelist.id);

    if (index === -1) {
      return data;
    }

    const newWhitelist = [...data.whitelist];
    newWhitelist[index] = whitelist;
    return { ...data, whitelist: newWhitelist };
  });
}

export async function deleteWhitelist(whitelistId: string): Promise<void> {
  await updateData((data) => ({
    ...data,
    whitelist: data.whitelist.filter((w) => w.id !== whitelistId),
  }));
}

export async function setSnooze(snooze: SnoozeState): Promise<void> {
  await Promise.all([
    updateData((data) => ({
      ...data,
      snooze,
    })),
    setSessionSnooze(snooze),
  ]);
}

export async function clearSnooze(): Promise<void> {
  await setSnooze({ active: false });
}
