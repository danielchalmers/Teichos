/**
 * Typed wrapper for chrome.storage API
 * Promise-based utilities for storage operations
 */

import type {
  BlockType,
  StorageData,
  FilterGroup,
  Filter,
  FilterBlockType,
  FilterMatchMode,
  TimeSchedule,
  Whitelist,
  SnoozeState,
} from '../types';
import { STORAGE_KEY, DEFAULT_GROUP_ID } from '../types';
import { getRegexValidationError } from '../utils';
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
    enabled: true,
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
    blockType: 'block',
    rulesVersion: 0,
  };
}

type LegacyFilter = Omit<Filter, 'matchMode'> & {
  readonly matchMode?: FilterMatchMode;
  readonly blockType?: FilterBlockType;
  readonly isRegex?: boolean;
};

type LegacyWhitelist = Omit<Whitelist, 'matchMode' | 'groupId'> & {
  readonly matchMode?: FilterMatchMode;
  readonly isRegex?: boolean;
  readonly groupId?: string;
};

interface LegacyStorageData {
  readonly groups?: readonly FilterGroup[];
  readonly filters?: readonly LegacyFilter[];
  readonly whitelist?: readonly LegacyWhitelist[];
  readonly rulesVersion?: number;
  readonly blockType?: BlockType;
  readonly snooze?: {
    readonly active?: boolean;
    readonly until?: number;
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMatchMode(value: unknown): value is FilterMatchMode {
  return value === 'contains' || value === 'exact' || value === 'regex';
}

function isValidBlockType(value: unknown): value is BlockType {
  return value === 'block' || value === 'warning';
}

function isValidFilterBlockType(value: unknown): value is FilterBlockType {
  return value === 'default' || isValidBlockType(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isValidDayOfWeek(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isValidSchedule(value: unknown): value is TimeSchedule {
  if (!isObject(value)) {
    return false;
  }

  return (
    Array.isArray(value['daysOfWeek']) &&
    value['daysOfWeek'].every(isValidDayOfWeek) &&
    typeof value['startTime'] === 'string' &&
    typeof value['endTime'] === 'string'
  );
}

function isValidGroup(value: unknown): value is FilterGroup {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['is24x7'] === 'boolean' &&
    isOptionalBoolean(value['enabled']) &&
    Array.isArray(value['schedules']) &&
    value['schedules'].every(isValidSchedule)
  );
}

function isValidFilterLike(value: unknown): value is LegacyFilter {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['pattern'] === 'string' &&
    typeof value['groupId'] === 'string' &&
    typeof value['enabled'] === 'boolean' &&
    (value['matchMode'] === undefined || isValidMatchMode(value['matchMode'])) &&
    (value['blockType'] === undefined || isValidFilterBlockType(value['blockType'])) &&
    isOptionalBoolean(value['isRegex']) &&
    isOptionalString(value['description']) &&
    isOptionalFiniteNumber(value['expiresAt'])
  );
}

function isValidWhitelistLike(value: unknown): value is LegacyWhitelist {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['pattern'] === 'string' &&
    typeof value['enabled'] === 'boolean' &&
    isOptionalString(value['groupId']) &&
    (value['matchMode'] === undefined || isValidMatchMode(value['matchMode'])) &&
    isOptionalBoolean(value['isRegex']) &&
    isOptionalString(value['description'])
  );
}

function isValidSnooze(value: unknown): value is LegacyStorageData['snooze'] {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  return isOptionalBoolean(value['active']) && isOptionalFiniteNumber(value['until']);
}

function assertUniqueIds(
  items: readonly { readonly id: string }[],
  entityName: 'group' | 'filter' | 'exception'
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Imported settings contain duplicate ${entityName} ids.`);
    }
    seen.add(item.id);
  }
}

function ensureDefaultGroup(groups: readonly FilterGroup[]): FilterGroup[] {
  if (groups.some((group) => group.id === DEFAULT_GROUP_ID)) {
    return [...groups];
  }

  return [createDefaultGroup(), ...groups];
}

function assertKnownGroupReferences(
  filters: readonly Filter[],
  whitelist: readonly Whitelist[],
  groups: readonly FilterGroup[]
): void {
  const groupIds = new Set(groups.map((group) => group.id));

  for (const filter of filters) {
    if (!groupIds.has(filter.groupId)) {
      throw new Error(`Imported filter "${filter.id}" references an unknown group.`);
    }
  }

  for (const entry of whitelist) {
    if (!groupIds.has(entry.groupId)) {
      throw new Error(`Imported exception "${entry.id}" references an unknown group.`);
    }
  }
}

function assertValidRegexEntries(
  filters: readonly Filter[],
  whitelist: readonly Whitelist[]
): void {
  for (const filter of filters) {
    if (filter.matchMode !== 'regex') {
      continue;
    }

    if (getRegexValidationError(filter.pattern)) {
      throw new Error(`Imported filter "${filter.id}" has an invalid regex pattern.`);
    }
  }

  for (const entry of whitelist) {
    if (entry.matchMode !== 'regex') {
      continue;
    }

    if (getRegexValidationError(entry.pattern)) {
      throw new Error(`Imported exception "${entry.id}" has an invalid regex pattern.`);
    }
  }
}

function validateImportedStorageShape(raw: JsonObject): void {
  const hasKnownCollections =
    Object.hasOwn(raw, 'groups') ||
    Object.hasOwn(raw, 'filters') ||
    Object.hasOwn(raw, 'whitelist');

  if (!hasKnownCollections) {
    throw new Error('Settings file does not contain Teichos data.');
  }

  if (Object.hasOwn(raw, 'groups')) {
    if (!Array.isArray(raw['groups']) || !raw['groups'].every(isValidGroup)) {
      throw new Error('Settings file contains invalid groups.');
    }
  }

  if (Object.hasOwn(raw, 'filters')) {
    if (!Array.isArray(raw['filters']) || !raw['filters'].every(isValidFilterLike)) {
      throw new Error('Settings file contains invalid filters.');
    }
  }

  if (Object.hasOwn(raw, 'whitelist')) {
    if (!Array.isArray(raw['whitelist']) || !raw['whitelist'].every(isValidWhitelistLike)) {
      throw new Error('Settings file contains invalid exceptions.');
    }
  }

  if (!isValidSnooze(raw['snooze'])) {
    throw new Error('Settings file contains an invalid snooze state.');
  }

  if (!isOptionalFiniteNumber(raw['rulesVersion'])) {
    throw new Error('Settings file contains an invalid rules version.');
  }

  if (raw['blockType'] !== undefined && !isValidBlockType(raw['blockType'])) {
    throw new Error('Settings file contains an invalid block type.');
  }
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

  const data = raw;
  const groups = normalizeGroups(data.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const filters = normalizeFilters(data.filters);
  const whitelist = normalizeWhitelist(data.whitelist, groupIds);
  const snooze = normalizeSnooze(data.snooze);
  const rulesVersion =
    typeof data.rulesVersion === 'number' && Number.isFinite(data.rulesVersion)
      ? data.rulesVersion
      : 0;
  const blockType = isValidBlockType(data.blockType) ? data.blockType : 'block';

  return {
    ...data,
    groups,
    filters,
    whitelist,
    snooze,
    blockType,
    rulesVersion,
  };
}

export function serializeDataForExport(data: StorageData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseImportedData(serialized: string): StorageData {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Settings file is not valid JSON.');
  }

  if (!isObject(parsed)) {
    throw new Error('Settings file must contain a JSON object.');
  }

  validateImportedStorageShape(parsed);

  const normalized = normalizeStoredData(parsed as LegacyStorageData);
  const groups = ensureDefaultGroup(normalized.groups);
  const importedData: StorageData = {
    ...normalized,
    groups,
  };

  assertUniqueIds(importedData.groups, 'group');
  assertUniqueIds(importedData.filters, 'filter');
  assertUniqueIds(importedData.whitelist, 'exception');
  assertKnownGroupReferences(importedData.filters, importedData.whitelist, importedData.groups);
  assertValidRegexEntries(importedData.filters, importedData.whitelist);

  return importedData;
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

export async function importData(serialized: string): Promise<StorageData> {
  const data = parseImportedData(serialized);
  await Promise.all([saveData(data), setSessionSnooze(data.snooze)]);
  return data;
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
