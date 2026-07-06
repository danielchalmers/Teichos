/**
 * Tests for shared/api/storage.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadData,
  saveData,
  addGroup,
  updateGroup,
  deleteGroup,
  addFilter,
  updateFilter,
  deleteFilter,
  addWhitelist,
  updateWhitelist,
  deleteWhitelist,
  createDefaultGroup,
  normalizeStoredData,
} from '../../../src/shared/api/storage';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';

describe('storage', () => {
  beforeEach(() => {
    getChromeMock().storage.sync._reset();
  });

  describe('loadData', () => {
    it('returns default data when storage is empty', async () => {
      const data = await loadData();

      expect(data).toEqual({
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [],
        snooze: { active: false },
        expandBlockPageDetails: false,
        rulesVersion: 0,
      });
    });

    it('does not persist default data when storage is empty', async () => {
      await loadData();

      expect(getChromeMock().storage.sync.set).not.toHaveBeenCalled();
      expect(getChromeMock().storage.sync._data.has(STORAGE_KEY)).toBe(false);
    });

    it('should load existing data from storage', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'test-filter',
            pattern: 'example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains' as const,
          },
        ],
        whitelist: [],
        snooze: { active: false },
        expandBlockPageDetails: true,
        rulesVersion: 2,
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data).toEqual(testData);
    });

    it('defaults missing group enabled state to true', async () => {
      getChromeMock().storage.sync._data.set(STORAGE_KEY, {
        groups: [
          {
            id: 'legacy-group',
            name: 'Legacy Group',
            schedules: [],
            is24x7: true,
          },
        ],
      });

      const data = await loadData();
      expect(data.groups).toEqual([
        {
          id: 'legacy-group',
          name: 'Legacy Group',
          schedules: [],
          is24x7: true,
          enabled: true,
        },
      ]);
    });

    it('preserves an explicitly disabled group state', async () => {
      getChromeMock().storage.sync._data.set(STORAGE_KEY, {
        groups: [
          {
            id: 'disabled-group',
            name: 'Disabled Group',
            schedules: [],
            is24x7: false,
            enabled: false,
          },
        ],
      });

      const data = await loadData();
      expect(data.groups).toEqual([
        {
          id: 'disabled-group',
          name: 'Disabled Group',
          schedules: [],
          is24x7: false,
          enabled: false,
        },
      ]);
    });

    it('should add empty whitelist for backwards compatibility', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.whitelist).toEqual([]);
      expect(data.snooze).toEqual({ active: false });
      expect(data.rulesVersion).toBe(0);
    });

    it('should assign the default group to legacy whitelist entries', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [{ id: 'legacy-whitelist', pattern: 'allowed.com', enabled: true }],
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.whitelist[0]?.groupId).toBe(DEFAULT_GROUP_ID);
    });

    it('should map legacy regex filters to match mode', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'regex-filter',
            pattern: '^https://example\\.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            isRegex: true,
          },
        ],
        whitelist: [],
        snooze: { active: false },
        rulesVersion: 1,
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.filters[0]?.matchMode).toBe('regex');
    });

    it('should default whitelist match mode to contains', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [
          {
            id: 'legacy-whitelist',
            pattern: 'allowed.com',
            enabled: true,
            groupId: DEFAULT_GROUP_ID,
          },
        ],
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.whitelist[0]?.matchMode).toBe('contains');
    });

    it('should preserve active snooze state', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [],
        snooze: { active: true, until: Date.now() + 60_000 },
        rulesVersion: 3,
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.snooze).toEqual(testData.snooze);
    });

    it('normalizes legacy storage data', () => {
      const data = normalizeStoredData({
        filters: [
          {
            id: 'legacy-filter',
            pattern: 'example.com',
            groupId: 'missing-group',
            enabled: true,
            isRegex: true,
          },
        ],
        whitelist: [{ id: 'legacy-whitelist', pattern: 'allowed.com', enabled: true }],
        snooze: { active: true },
      });

      expect(data).toEqual({
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'legacy-filter',
            pattern: 'example.com',
            groupId: 'missing-group',
            enabled: true,
            matchMode: 'regex',
          },
        ],
        whitelist: [
          {
            id: 'legacy-whitelist',
            pattern: 'allowed.com',
            enabled: true,
            groupId: DEFAULT_GROUP_ID,
            matchMode: 'contains',
          },
        ],
        snooze: { active: true },
        expandBlockPageDetails: false,
        rulesVersion: 0,
      });
    });

    it('strips retired block type values from storage and filters', async () => {
      getChromeMock().storage.sync._data.set(STORAGE_KEY, {
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'legacy-filter',
            pattern: 'example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
            blockType: 'warning',
          },
        ],
        blockType: 'warning',
      });

      const data = await loadData();
      expect(data).not.toHaveProperty('blockType');
      expect(data.filters[0]).not.toHaveProperty('blockType');
    });

    it('defaults the expand block page details setting to false', async () => {
      getChromeMock().storage.sync._data.set(STORAGE_KEY, {
        groups: [createDefaultGroup()],
        filters: [],
      });

      const data = await loadData();
      expect(data.expandBlockPageDetails).toBe(false);
    });

    it('coerces invalid expand block page details values to false', () => {
      const data = normalizeStoredData({
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [],
        expandBlockPageDetails: 'yes' as unknown as boolean,
      });

      expect(data.expandBlockPageDetails).toBe(false);
    });
  });

  describe('saveData', () => {
    it('should save data to storage', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'test-filter',
            pattern: 'example.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains' as const,
          },
        ],
        whitelist: [],
        snooze: { active: false },
        rulesVersion: 0,
      };

      await saveData(testData);

      expect(getChromeMock().storage.sync._data.get(STORAGE_KEY)).toEqual({
        ...testData,
        rulesVersion: 1,
      });
    });
  });

  describe('group and filter CRUD', () => {
    it('adds, updates, and removes groups and filters', async () => {
      await loadData();

      const group = {
        id: 'test-group',
        name: 'Test Group',
        schedules: [],
        is24x7: false,
      };
      await addGroup(group);
      await updateGroup({ ...group, name: 'Updated Group' });

      const filter = {
        id: 'test-filter',
        pattern: 'example.com',
        groupId: group.id,
        enabled: true,
        matchMode: 'contains' as const,
      };
      await addFilter(filter);
      await updateFilter({ ...filter, enabled: false });

      let data = await loadData();
      expect(data.groups).toEqual([
        createDefaultGroup(),
        { ...group, name: 'Updated Group', enabled: true },
      ]);
      expect(data.filters).toEqual([{ ...filter, enabled: false }]);

      await deleteFilter(filter.id);

      data = await loadData();
      expect(data.filters).toEqual([]);
    });
  });

  describe('deleteGroup', () => {
    it('should throw error when trying to delete default group', async () => {
      await loadData();

      await expect(deleteGroup(DEFAULT_GROUP_ID)).rejects.toThrow(
        'Cannot delete the default 24/7 group'
      );
    });

    it('should delete a group and reassign filters to default group', async () => {
      await loadData();

      const newGroup = {
        id: 'test-group',
        name: 'Test Group',
        schedules: [],
        is24x7: false,
      };
      await addGroup(newGroup);

      const filter = {
        id: 'test-filter',
        pattern: 'example.com',
        groupId: 'test-group',
        enabled: true,
        matchMode: 'contains' as const,
      };
      await addFilter(filter);

      const whitelistEntry = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        groupId: 'test-group',
        enabled: true,
        matchMode: 'contains' as const,
      };
      await addWhitelist(whitelistEntry);

      await deleteGroup('test-group');

      const data = await loadData();
      expect(data.groups).toHaveLength(1);
      expect(data.filters[0]?.groupId).toBe(DEFAULT_GROUP_ID);
      expect(data.whitelist[0]?.groupId).toBe(DEFAULT_GROUP_ID);
    });
  });

  describe('whitelist operations', () => {
    it('should add, update, and delete whitelist entries', async () => {
      await loadData();

      const entry = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains' as const,
      };

      await addWhitelist(entry);
      let data = await loadData();
      expect(data.whitelist).toHaveLength(1);

      await updateWhitelist({ ...entry, enabled: false });
      data = await loadData();
      expect(data.whitelist[0]?.enabled).toBe(false);

      await deleteWhitelist('test-whitelist');
      data = await loadData();
      expect(data.whitelist).toHaveLength(0);
    });
  });
});
