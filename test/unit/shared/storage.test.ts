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
            matchMode: 'contains',
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
            matchMode: 'contains',
          },
        ],
        whitelist: [],
        snooze: { active: false },
      };

      await saveData(testData);

      expect(getChromeMock().storage.sync._data.get(STORAGE_KEY)).toEqual(testData);
    });
  });

  describe('addGroup', () => {
    it('should add a new group', async () => {
      await loadData();

      const newGroup = {
        id: 'test-group',
        name: 'Test Group',
        schedules: [],
        is24x7: false,
      };

      await addGroup(newGroup);

      const data = await loadData();
      expect(data.groups).toHaveLength(2);
      expect(data.groups[1]).toEqual(newGroup);
    });
  });

  describe('updateGroup', () => {
    it('should update an existing group', async () => {
      await loadData();

      const group = createDefaultGroup();
      const updatedGroup = { ...group, name: 'Updated Name' };

      await updateGroup(updatedGroup);

      const data = await loadData();
      expect(data.groups[0]?.name).toBe('Updated Name');
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
        matchMode: 'contains',
      };
      await addFilter(filter);

      const whitelistEntry = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        groupId: 'test-group',
        enabled: true,
        matchMode: 'contains',
      };
      await addWhitelist(whitelistEntry);

      await deleteGroup('test-group');

      const data = await loadData();
      expect(data.groups).toHaveLength(1);
      expect(data.filters[0]?.groupId).toBe(DEFAULT_GROUP_ID);
      expect(data.whitelist[0]?.groupId).toBe(DEFAULT_GROUP_ID);
    });
  });

  describe('addFilter', () => {
    it('should add a new filter', async () => {
      await loadData();

      const filter = {
        id: 'test-filter',
        pattern: 'example.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
      };

      await addFilter(filter);

      const data = await loadData();
      expect(data.filters).toHaveLength(1);
      expect(data.filters[0]).toEqual(filter);
    });
  });

  describe('updateFilter', () => {
    it('should update an existing filter', async () => {
      await loadData();

      const filter = {
        id: 'test-filter',
        pattern: 'example.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
      };
      await addFilter(filter);

      const updatedFilter = { ...filter, enabled: false };
      await updateFilter(updatedFilter);

      const data = await loadData();
      expect(data.filters[0]?.enabled).toBe(false);
    });
  });

  describe('deleteFilter', () => {
    it('should delete a filter', async () => {
      await loadData();

      const filter = {
        id: 'test-filter',
        pattern: 'example.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
      };
      await addFilter(filter);

      await deleteFilter('test-filter');

      const data = await loadData();
      expect(data.filters).toHaveLength(0);
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
        matchMode: 'contains',
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
