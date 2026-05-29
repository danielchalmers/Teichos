import type {
  BlockType,
  Filter,
  FilterBlockType,
  FilterGroup,
  FilterMatchMode,
  SnoozeState,
  TimeSchedule,
  Whitelist,
} from '../types';

export type JsonObject = Record<string, unknown>;

export interface FilterLike extends Omit<Filter, 'matchMode'> {
  readonly matchMode?: FilterMatchMode;
  readonly blockType?: FilterBlockType;
  readonly isRegex?: boolean;
}

export interface WhitelistLike extends Omit<Whitelist, 'matchMode' | 'groupId'> {
  readonly matchMode?: FilterMatchMode;
  readonly isRegex?: boolean;
  readonly groupId?: string;
}

export interface SnoozeLike {
  readonly active?: boolean;
  readonly until?: number;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidMatchMode(value: unknown): value is FilterMatchMode {
  return value === 'contains' || value === 'exact' || value === 'regex';
}

export function isValidBlockType(value: unknown): value is BlockType {
  return value === 'block' || value === 'warning';
}

export function isValidFilterBlockType(value: unknown): value is FilterBlockType {
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

export function isValidSchedule(value: unknown): value is TimeSchedule {
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

export function isValidGroup(value: unknown): value is FilterGroup {
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

export function isValidFilterLike(value: unknown): value is FilterLike {
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

export function isValidWhitelistLike(value: unknown): value is WhitelistLike {
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

export function isValidSnooze(value: unknown): value is SnoozeLike | undefined {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  return isOptionalBoolean(value['active']) && isOptionalFiniteNumber(value['until']);
}

export function isValidSnoozeState(value: unknown): value is SnoozeState {
  if (!isObject(value)) {
    return false;
  }

  return typeof value['active'] === 'boolean' && isOptionalFiniteNumber(value['until']);
}
