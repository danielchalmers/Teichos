import type { FilterGroup, StorageData } from '../types';
import { CURRENT_SCHEMA_VERSION, DEFAULT_GROUP_ID } from '../types';

export function createDefaultGroup(): FilterGroup {
  return {
    id: DEFAULT_GROUP_ID,
    name: '24/7 (Always Active)',
    schedules: [],
    is24x7: true,
    enabled: true,
  };
}

export function createDefaultData(): StorageData {
  return {
    groups: [createDefaultGroup()],
    filters: [],
    whitelist: [],
    snooze: { active: false },
    expandBlockPageDetails: false,
    rulesVersion: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
