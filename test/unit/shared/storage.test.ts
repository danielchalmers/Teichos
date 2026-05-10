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
} from '../../../src/shared/api/storage';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';

describe('storage', () => {
  beforeEach(() => {
    getChromeMock().storage.sync._reset();
  });

  describe('loadData', () => {
    it('should create default data when storage is empty', async () => {
      const data = await loadData();

      expect(data.groups).toHaveLength(1);
      expect(data.groups[0]?.id).toBe(DEFAULT_GROUP_ID);
      expect(data.filters).toEqual([]);
      expect(data.whitelist).toEqual([]);
      expect(data.snooze).toEqual({ active: false });
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
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data).toEqual(testData);
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
      };

      getChromeMock().storage.sync._data.set(STORAGE_KEY, testData);

      const data = await loadData();
      expect(data.snooze).toEqual(testData.snooze);
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
      };

      await saveData(testData);

      expect(getChromeMock().storage.sync._data.get(STORAGE_KEY)).toEqual(testData);
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
      expect(data.groups).toEqual([createDefaultGroup(), { ...group, name: 'Updated Group' }]);
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
