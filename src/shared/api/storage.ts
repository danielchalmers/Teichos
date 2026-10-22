/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type { StorageData, FilterGroup, Filter, Whitelist, SnoozeState } from '../types';
import { DEFAULT_GROUP_ID } from '../types';
import { isTemporaryFilterExpired } from '../filtering/schedules';
import { parseImportedData, serializeDataForExport } from '../storage/importExport';
import { normalizeStoredData, type LegacyStorageData } from '../storage/normalize';
import {
  decodeSettings,
  encodeSettings,
  isSettingsKey,
  type DecodedSettings,
} from '../storage/syncLayout';
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

interface StoredSettings {
  readonly decoded: DecodedSettings;
  /** Settings keys present in sync storage, in either layout (see syncLayout). */
  readonly keys: readonly string[];
}

async function readStoredSettings(): Promise<StoredSettings> {
  const items = await chrome.storage.sync.get(null);
  return { decoded: decodeSettings(items), keys: Object.keys(items).filter(isSettingsKey) };
}

async function writeStorageData(
  payload: StorageData,
  storedKeys: readonly string[]
): Promise<void> {
  const { items, staleKeys } = encodeSettings(payload, storedKeys);
  try {
    await chrome.storage.sync.set(items);
  } catch (error) {
    if (isSyncQuotaError(error)) {
      throw new SettingsSaveError(SYNC_QUOTA_MESSAGE);
    }
    throw error;
  }

  // Stale items are already outranked by the copy just written, so leaving them only costs quota.
  if (staleKeys.length > 0) {
    await chrome.storage.sync.remove([...staleKeys]).catch((error: unknown) => {
      console.warn('[Teichos] Failed to remove stale settings items:', error);
    });
  }
}

// Settings split across items can arrive from another device one item at a time. A reader then
// waits briefly for the rest, and otherwise keeps the newest complete copy it has seen.
const INCOMPLETE_RETRY_DELAY_MS = 100;
const INCOMPLETE_RETRIES = 10;
let newestCompleteRaw: unknown;

async function readCompleteSettings(): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const { decoded } = await readStoredSettings();
    if (decoded.complete) {
      newestCompleteRaw = decoded.raw;
      return decoded.raw;
    }
    if (attempt >= INCOMPLETE_RETRIES) {
      const fallback =
        rulesVersionOf(newestCompleteRaw) >= rulesVersionOf(decoded.raw)
          ? newestCompleteRaw
          : decoded.raw;
      return claimLatestRulesVersion(fallback, decoded.latestRulesVersion);
    }
    await new Promise((resolve) => setTimeout(resolve, INCOMPLETE_RETRY_DELAY_MS));
  }
}

/**
 * A copy still unassembled after the wait is treated as broken, for example a mix of two devices'
 * parts left by a sync conflict, which no amount of waiting fixes. The fallback takes its
 * rulesVersion, so the next save replaces it instead of every save failing as a conflict.
 */
function claimLatestRulesVersion(raw: unknown, latestRulesVersion: number | undefined): unknown {
  if (raw === null || typeof raw !== 'object' || latestRulesVersion === undefined) {
    return raw;
  }
  return { ...raw, rulesVersion: latestRulesVersion };
}

function rulesVersionOf(raw: unknown): number {
  const rulesVersion = (raw as { rulesVersion?: unknown } | undefined)?.rulesVersion;
  return typeof rulesVersion === 'number' ? rulesVersion : -1;
}

/**
 * Load storage data from chrome.storage.sync
 */
export async function loadData(): Promise<StorageData> {
  return normalizeStoredData((await readCompleteSettings()) as LegacyStorageData | undefined);
}

export async function exportData(): Promise<string> {
  return serializeDataForExport(await loadData());
}

/**
 * Save storage data to chrome.storage.sync, replacing whatever is stored.
 * Prefer updateData for read-modify-write edits so concurrent writers cannot clobber each other.
 */
export async function saveData(data: StorageData): Promise<void> {
  const stored = await readStoredSettings();
  const previousRulesVersion =
    stored.decoded.latestRulesVersion ??
    (typeof data.rulesVersion === 'number' && Number.isFinite(data.rulesVersion)
      ? data.rulesVersion
      : 0);

  await writeStorageData(
    {
      ...data,
      rulesVersion: previousRulesVersion + 1,
    },
    stored.keys
  );
}

/**
 * Save only when the stored rulesVersion still matches the snapshot the caller loaded.
 * Returns false without writing when another context saved in between.
 */
async function saveDataIfUnchanged(
  data: StorageData,
  expectedRulesVersion: number
): Promise<boolean> {
  // A newer copy still arriving from another device counts as a change, so this never writes over
  // settings it hasn't seen.
  const stored = await readStoredSettings();
  const storedRulesVersion = stored.decoded.latestRulesVersion;
  if (storedRulesVersion !== undefined && storedRulesVersion !== expectedRulesVersion) {
    return false;
  }

  await writeStorageData(
    {
      ...data,
      rulesVersion: (storedRulesVersion ?? expectedRulesVersion) + 1,
    },
    stored.keys
  );
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
