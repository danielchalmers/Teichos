import type { Filter, FilterGroup, StorageData, Whitelist } from '../types';
import { DEFAULT_GROUP_ID } from '../types';
import { getRegexValidationError } from '../filtering/patterns';
import {
  isObject,
  isValidBlockType,
  isValidFilterLike,
  isValidGroup,
  isValidSnooze,
  isValidWhitelistLike,
  type JsonObject,
} from './guards';
import { createDefaultGroup } from './defaults';
import { normalizeStoredData, type LegacyStorageData } from './normalize';

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

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
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
