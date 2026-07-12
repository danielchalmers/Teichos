/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type { StorageData, FilterGroup, Filter, Whitelist, SnoozeState } from '../types';
import { STORAGE_KEY, DEFAULT_GROUP_ID } from '../types';
import { isTemporaryFilterExpired } from '../filtering/schedules';
import { parseImportedData, serializeDataForExport } from '../storage/importExport';
import { normalizeStoredData, type LegacyStorageData } from '../storage/normalize';
import { createDefaultGroup } from '../storage/defaults';
import { setSessionSnooze } from './session';

export { createDefaultGroup };
export { normalizeStoredData };
export { serializeDataForExport, parseImportedData };

/**
 * A settings write failed for a reason the user can act on; the message is safe to display.
 */
export class SettingsSaveError extends Error {}

const SYNC_QUOTA_MESSAGE =
  'Browser sync storage is full, so the change could not be saved. Remove some filters or exceptions, or shorten long patterns, and try again.';

function isSyncQuotaError(error: unknown): boolean {
  return error instanceof Error && /quota.?bytes|quota exceeded/i.test(error.message);
}

async function writeStorageData(payload: StorageData): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: payload });
  } catch (error) {
    if (isSyncQuotaError(error)) {
      throw new SettingsSaveError(SYNC_QUOTA_MESSAGE);
    }
    throw error;
  }
}

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
 * Save storage data to chrome.storage.sync, replacing whatever is stored.
 * Prefer updateData for read-modify-write edits so concurrent writers cannot clobber each other.
 */
export async function saveData(data: StorageData): Promise<void> {
  const storedRulesVersion = await readStoredRulesVersion();
  const previousRulesVersion =
    storedRulesVersion ??
    (typeof data.rulesVersion === 'number' && Number.isFinite(data.rulesVersion)
      ? data.rulesVersion
      : 0);

  await writeStorageData({
    ...data,
    rulesVersion: previousRulesVersion + 1,
  });
}

async function readStoredRulesVersion(): Promise<number | undefined> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const storedData = result[STORAGE_KEY] as { rulesVersion?: unknown } | undefined;
  return typeof storedData?.rulesVersion === 'number' && Number.isFinite(storedData.rulesVersion)
    ? storedData.rulesVersion
    : undefined;
}

/**
 * Save only when the stored rulesVersion still matches the snapshot the caller loaded.
 * Returns false without writing when another context saved in between.
 */
async function saveDataIfUnchanged(
  data: StorageData,
  expectedRulesVersion: number
): Promise<boolean> {
  const storedRulesVersion = await readStoredRulesVersion();
  if (storedRulesVersion !== undefined && storedRulesVersion !== expectedRulesVersion) {
    return false;
  }

  await writeStorageData({
    ...data,
    rulesVersion: (storedRulesVersion ?? expectedRulesVersion) + 1,
  });
  return true;
}

const MAX_UPDATE_ATTEMPTS = 4;

/**
 * Apply a read-modify-write edit to the stored data. Every writer (popup, options, background)
 * shares one sync item, so a plain load-then-save can silently drop a concurrent writer's
 * changes; retry against a fresh snapshot when the stored rulesVersion moved underneath us.
 */
export async function updateData(
  updater: (data: StorageData) => StorageData
): Promise<StorageData> {
  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
    const data = await loadData();
    const updatedData = updater(data);

    if (updatedData === data) {
      return updatedData;
    }

    if (await saveDataIfUnchanged(updatedData, data.rulesVersion)) {
      return updatedData;
    }
  }

  throw new SettingsSaveError('Settings changed in another window while saving. Please try again.');
}

/**
 * Delete expired temporary filters. Both the popup and the options page call this on render so
 * an expired temporary block has the same lifecycle everywhere: it disappears from storage
 * instead of lingering as an inactive entry one surface can no longer remove.
 */
export async function purgeExpiredTemporaryFilters(data: StorageData): Promise<StorageData> {
  const now = Date.now();
  if (!data.filters.some((filter) => isTemporaryFilterExpired(filter, now))) {
    return data;
  }

  return updateData((current) => {
    const remainingFilters = current.filters.filter(
      (filter) => !isTemporaryFilterExpired(filter, now)
    );
    return remainingFilters.length === current.filters.length
      ? current
      : { ...current, filters: remainingFilters };
  });
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
    filters: data.filters.map((f) =>
      f.groupId === groupId ? { ...f, groupId: DEFAULT_GROUP_ID } : f
    ),
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
