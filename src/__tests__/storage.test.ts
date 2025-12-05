import { describe, it, expect, beforeEach, vi } from 'vitest';
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
} from '../storage';
import { DEFAULT_GROUP_ID, createDefaultGroup } from '../types';

// Mock Chrome storage API
const mockStorage = new Map<string, unknown>();

global.chrome = {
  storage: {
    sync: {
      get: vi.fn((keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach(key => {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        });
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.entries(items).forEach(([key, value]) => {
          mockStorage.set(key, value);
        });
        return Promise.resolve();
      }),
    },
  },
} as unknown as typeof chrome;

describe('storage', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  describe('loadData', () => {
    it('should create default data when storage is empty', async () => {
      const data = await loadData();
      
      expect(data.groups).toHaveLength(1);
      expect(data.groups[0]?.id).toBe(DEFAULT_GROUP_ID);
      expect(data.filters).toEqual([]);
      expect(data.whitelist).toEqual([]);
    });

    it('should load existing data from storage', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [{ id: 'test-filter', pattern: 'example.com', groupId: DEFAULT_GROUP_ID, enabled: true }],
        whitelist: [],
      };
      
      mockStorage.set('pageblock_data', testData);
      
      const data = await loadData();
      expect(data).toEqual(testData);
    });

    it('should add empty whitelist for backwards compatibility', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
        // whitelist intentionally missing
      };
      
      mockStorage.set('pageblock_data', testData);
      
      const data = await loadData();
      expect(data.whitelist).toEqual([]);
    });
  });

  describe('saveData', () => {
    it('should save data to storage', async () => {
      const testData = {
        groups: [createDefaultGroup()],
        filters: [{ id: 'test-filter', pattern: 'example.com', groupId: DEFAULT_GROUP_ID, enabled: true }],
        whitelist: [],
      };
      
      await saveData(testData);
      
      expect(mockStorage.get('pageblock_data')).toEqual(testData);
    });
  });

  describe('addGroup', () => {
    it('should add a new group', async () => {
      await loadData(); // Initialize with default data
      
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
      await loadData(); // Initialize with default data
      
      const group = createDefaultGroup();
      const updatedGroup = { ...group, name: 'Updated Name' };
      
      await updateGroup(updatedGroup);
      
      const data = await loadData();
      expect(data.groups[0]?.name).toBe('Updated Name');
    });

    it('should not modify data if group not found', async () => {
      await loadData(); // Initialize with default data
      
      const nonExistentGroup = {
        id: 'non-existent',
        name: 'Non Existent',
        schedules: [],
        is24x7: false,
      };
      
      await updateGroup(nonExistentGroup);
      
      const data = await loadData();
      expect(data.groups).toHaveLength(1);
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
      };
      
      await addFilter(filter);
      
      await deleteGroup('test-group');
      
      const data = await loadData();
      expect(data.groups).toHaveLength(1);
      expect(data.filters[0]?.groupId).toBe(DEFAULT_GROUP_ID);
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
        description: 'Test filter',
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
      };
      
      await addFilter(filter);
      
      const updatedFilter = { ...filter, enabled: false, description: 'Updated' };
      await updateFilter(updatedFilter);
      
      const data = await loadData();
      expect(data.filters[0]?.enabled).toBe(false);
      expect(data.filters[0]?.description).toBe('Updated');
    });

    it('should not modify data if filter not found', async () => {
      await loadData();
      
      const nonExistentFilter = {
        id: 'non-existent',
        pattern: 'test.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
      };
      
      await updateFilter(nonExistentFilter);
      
      const data = await loadData();
      expect(data.filters).toHaveLength(0);
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
      };
      
      await addFilter(filter);
      
      await deleteFilter('test-filter');
      
      const data = await loadData();
      expect(data.filters).toHaveLength(0);
    });

    it('should not error if filter does not exist', async () => {
      await loadData();
      
      await deleteFilter('non-existent');
      
      const data = await loadData();
      expect(data.filters).toHaveLength(0);
    });
  });

  describe('addWhitelist', () => {
    it('should add a new whitelist entry', async () => {
      await loadData();
      
      const whitelist = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        enabled: true,
        description: 'Allowed site',
      };
      
      await addWhitelist(whitelist);
      
      const data = await loadData();
      expect(data.whitelist).toHaveLength(1);
      expect(data.whitelist[0]).toEqual(whitelist);
    });
  });

  describe('updateWhitelist', () => {
    it('should update an existing whitelist entry', async () => {
      await loadData();
      
      const whitelist = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        enabled: true,
      };
      
      await addWhitelist(whitelist);
      
      const updatedWhitelist = { ...whitelist, enabled: false, description: 'Updated' };
      await updateWhitelist(updatedWhitelist);
      
      const data = await loadData();
      expect(data.whitelist[0]?.enabled).toBe(false);
      expect(data.whitelist[0]?.description).toBe('Updated');
    });

    it('should not modify data if whitelist entry not found', async () => {
      await loadData();
      
      const nonExistentWhitelist = {
        id: 'non-existent',
        pattern: 'test.com',
        enabled: true,
      };
      
      await updateWhitelist(nonExistentWhitelist);
      
      const data = await loadData();
      expect(data.whitelist).toHaveLength(0);
    });
  });

  describe('deleteWhitelist', () => {
    it('should delete a whitelist entry', async () => {
      await loadData();
      
      const whitelist = {
        id: 'test-whitelist',
        pattern: 'allowed.com',
        enabled: true,
      };
      
      await addWhitelist(whitelist);
      
      await deleteWhitelist('test-whitelist');
      
      const data = await loadData();
      expect(data.whitelist).toHaveLength(0);
    });

    it('should not error if whitelist entry does not exist', async () => {
      await loadData();
      
      await deleteWhitelist('non-existent');
      
      const data = await loadData();
      expect(data.whitelist).toHaveLength(0);
    });
  });
});
