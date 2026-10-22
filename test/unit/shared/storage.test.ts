/**
 * Tests for shared/api/storage.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  loadData,
  saveData,
  updateData,
  purgeExpiredTemporaryFilters,
  SettingsSaveError,
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
  setSnooze,
  clearSnooze,
} from '../../../src/shared/api/storage';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';
import type { Filter, StorageData } from '../../../src/shared/types';
import type { LegacyStorageData } from '../../../src/shared/storage/normalize';
import { getChromeMock } from '../../fixtures/chrome-mocks';
import {
  encodeSettings,
  SPLIT_INDEX_KEY,
  splitPartKey,
} from '../../../src/shared/storage/syncLayout';

describe('storage', () => {
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
        schemaVersion: 2,
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
        schemaVersion: 2,
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
            pattern: 'allowed.com/docs',
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
            groupId: DEFAULT_GROUP_ID,
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
            // A site name with no match mode is legacy contains text, which schema 2 migrates.
            matchMode: 'domain',
          },
        ],
        snooze: { active: true },
        expandBlockPageDetails: false,
        rulesVersion: 0,
        schemaVersion: 2,
      });
    });

    it('turns site-name contains patterns into domains once, when domain matching arrives', () => {
      const legacyFilter = (
        id: string,
        pattern: string,
        matchMode: Filter['matchMode'] = 'contains'
      ): Filter => ({
        id,
        pattern,
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode,
      });
      const migrated = normalizeStoredData({
        filters: [
          legacyFilter('site', 'x.com'),
          legacyFilter('path', 'youtube.com/shorts'),
          legacyFilter('word', 'reddit'),
          legacyFilter('file', 'viewtopic.php'),
          legacyFilter('struts', 'login.do'),
          { ...legacyFilter('exact', 'https://x.com/'), matchMode: 'exact' },
        ],
        whitelist: [
          { id: 'allow-site', pattern: 'docs.google.com', enabled: true, matchMode: 'contains' },
        ],
      });

      expect(
        Object.fromEntries(migrated.filters.map((filter) => [filter.id, filter.matchMode]))
      ).toEqual({
        site: 'domain',
        path: 'contains',
        word: 'contains',
        file: 'contains',
        struts: 'contains',
        exact: 'exact',
      });
      // An exception matched as text also allowed any blocked address that mentioned it.
      expect(migrated.whitelist[0]?.matchMode).toBe('domain');
      expect(migrated.schemaVersion).toBe(2);

      // Once saved at schema 2, a site name the user sets back to contains stays contains.
      const chosen = normalizeStoredData({
        ...migrated,
        filters: [legacyFilter('site', 'x.com')],
      });
      expect(chosen.filters[0]?.matchMode).toBe('contains');
    });

    it('reassigns filters whose group no longer exists to the default group', async () => {
      getChromeMock().storage.sync._data.set(STORAGE_KEY, {
        groups: [{ id: 'custom-group', name: 'Custom', schedules: [], is24x7: true }],
        filters: [
          {
            id: 'orphaned-filter',
            pattern: 'example.com',
            groupId: 'deleted-group',
            enabled: true,
            matchMode: 'contains',
          },
        ],
        whitelist: [],
      });

      const data = await loadData();
      expect(data.filters[0]?.groupId).toBe(DEFAULT_GROUP_ID);
      // The default group is added so the reassigned filter stays active.
      expect(data.groups.some((group) => group.id === DEFAULT_GROUP_ID)).toBe(true);
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

    it.each([
      { pattern: '', label: 'an empty' },
      { pattern: '   ', label: 'a whitespace-only' },
    ])('drops $label filter and exception pattern', ({ pattern }) => {
      const data = normalizeStoredData({
        groups: [createDefaultGroup()],
        filters: [{ id: 'blank', pattern, groupId: DEFAULT_GROUP_ID, enabled: true }],
        whitelist: [{ id: 'blank-exception', pattern, enabled: true }],
      });

      // Matching is substring-based, so a blank filter blocks the whole web and a blank
      // exception disables every filter in its group.
      expect(data.filters).toEqual([]);
      expect(data.whitelist).toEqual([]);
    });

    it('repairs malformed synced groups instead of throwing on evaluation', () => {
      const data = normalizeStoredData({
        groups: [
          createDefaultGroup(),
          { id: 'broken', name: 'Broken', is24x7: false, schedules: null },
          {
            id: 'mixed',
            name: 'Mixed',
            is24x7: false,
            schedules: [
              { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' },
              { daysOfWeek: 'weekdays', startTime: '9am', endTime: '' },
            ],
          },
          null,
        ],
        filters: [null, { id: 'kept', pattern: 'reddit.com', groupId: 'broken', enabled: true }],
        whitelist: 'not-a-list',
      } as unknown as LegacyStorageData);

      expect(data.groups.map((group) => group.id)).toEqual([DEFAULT_GROUP_ID, 'broken', 'mixed']);
      expect(data.groups[1]?.schedules).toEqual([]);
      expect(data.groups[2]?.schedules).toEqual([
        { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' },
      ]);
      expect(data.filters.map((filter) => filter.id)).toEqual(['kept']);
      expect(data.whitelist).toEqual([]);
    });

    it('trims surrounding whitespace from non-regex patterns', () => {
      const data = normalizeStoredData({
        groups: [createDefaultGroup()],
        filters: [
          { id: 'pasted', pattern: '  reddit.com  ', groupId: DEFAULT_GROUP_ID, enabled: true },
        ],
        whitelist: [{ id: 'pasted-exception', pattern: ' docs.google.com ', enabled: true }],
      });

      expect(data.filters[0]?.pattern).toBe('reddit.com');
      expect(data.whitelist[0]?.pattern).toBe('docs.google.com');
    });

    it('leaves regex patterns byte-exact, since whitespace can be meaningful', () => {
      const data = normalizeStoredData({
        groups: [createDefaultGroup()],
        filters: [
          {
            id: 'regex',
            pattern: 'reddit[.]com/r/ ',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'regex',
          },
        ],
        whitelist: [],
      });

      expect(data.filters[0]?.pattern).toBe('reddit[.]com/r/ ');
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
        schemaVersion: 2,
      };

      await saveData(testData);

      expect(getChromeMock().storage.sync._data.get(STORAGE_KEY)).toEqual({
        ...testData,
        rulesVersion: 1,
      });
    });

    it('maps sync quota rejections to an actionable SettingsSaveError', async () => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync.set.mockRejectedValueOnce(
        new Error('Resource::kQuotaBytesPerItem quota exceeded')
      );

      const testData = {
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [],
        snooze: { active: false },
        rulesVersion: 0,
        schemaVersion: 2,
      };

      const error = await saveData(testData).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SettingsSaveError);
      expect((error as Error).message).toContain('Browser sync storage is full');
    });

    it('rethrows other write failures unchanged', async () => {
      const writeError = new Error('Storage backend unavailable');
      getChromeMock().storage.sync.set.mockRejectedValueOnce(writeError);

      await expect(
        saveData({
          groups: [createDefaultGroup()],
          filters: [],
          whitelist: [],
          snooze: { active: false },
          rulesVersion: 0,
          schemaVersion: 2,
        })
      ).rejects.toBe(writeError);
    });
  });

  describe('settings larger than one sync item', () => {
    const createLargeData = (filterCount: number): StorageData => ({
      groups: [createDefaultGroup()],
      filters: Array.from({ length: filterCount }, (_, index) => ({
        id: `filter-${String(index)}-${'x'.repeat(20)}`,
        pattern: `site-${String(index)}.example.com`,
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'domain' as const,
        description: `Site number ${String(index)}`,
      })),
      whitelist: [],
      snooze: { active: false },
      expandBlockPageDetails: false,
      rulesVersion: 0,
      schemaVersion: 2,
    });

    it('saves and loads them, keeping the single-item copy older versions read', async () => {
      const small = createLargeData(5);
      await saveData(small);
      const large = createLargeData(300);
      await saveData(large);

      const stored = getChromeMock().storage.sync._data;
      expect(stored.has(SPLIT_INDEX_KEY)).toBe(true);
      // Older versions keep reading their last copy rather than misreading the split layout.
      expect(stored.get(STORAGE_KEY)).toEqual({ ...small, rulesVersion: 1 });
      await expect(loadData()).resolves.toEqual({ ...large, rulesVersion: 2 });

      // Back under the limit, the settings return to one item and the split items are removed.
      await saveData(createLargeData(5));
      expect([...stored.keys()]).toEqual([STORAGE_KEY]);
      await expect(loadData()).resolves.toEqual({ ...createLargeData(5), rulesVersion: 3 });
    });

    // Each reader remembers the newest complete copy it has seen, so these start from a fresh one.
    const loadFreshStorage = async (): Promise<
      typeof import('../../../src/shared/api/storage')
    > => {
      vi.resetModules();
      return import('../../../src/shared/api/storage');
    };

    it('waits for a newer copy still arriving, then keeps the newest complete one', async () => {
      const { loadData } = await loadFreshStorage();
      vi.useFakeTimers();
      const stored = getChromeMock().storage.sync._data;
      const older = { ...createLargeData(5), rulesVersion: 4 };
      stored.set(STORAGE_KEY, older);
      // A newer split copy whose last part has not arrived from the other device yet.
      const { items } = encodeSettings({ ...createLargeData(300), rulesVersion: 5 }, []);
      for (const [key, value] of Object.entries(items)) {
        if (key !== splitPartKey(1)) stored.set(key, value);
      }

      const loading = loadData();
      await vi.advanceTimersByTimeAsync(250);
      // The missing part arrives while the reader waits.
      stored.set(splitPartKey(1), items[splitPartKey(1)]);
      await vi.runAllTimersAsync();
      await expect(loading).resolves.toEqual({ ...createLargeData(300), rulesVersion: 5 });

      // If it never arrives, the reader settles for the newest complete copy.
      stored.delete(splitPartKey(1));
      const stale = loadData();
      await vi.runAllTimersAsync();
      await expect(stale).resolves.toEqual({ ...createLargeData(300), rulesVersion: 5 });
    });

    it('never saves over a newer copy that has not fully arrived', async () => {
      const { updateData, SettingsSaveError } = await loadFreshStorage();
      vi.useFakeTimers();
      const stored = getChromeMock().storage.sync._data;
      stored.set(STORAGE_KEY, { ...createLargeData(5), rulesVersion: 4 });
      const { items } = encodeSettings({ ...createLargeData(300), rulesVersion: 5 }, []);
      stored.set(SPLIT_INDEX_KEY, items[SPLIT_INDEX_KEY]);

      const saving = updateData((data) => ({ ...data, expandBlockPageDetails: true }));
      const rejection = expect(saving).rejects.toBeInstanceOf(SettingsSaveError);
      await vi.runAllTimersAsync();
      await rejection;
      expect(getChromeMock().storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('updateData', () => {
    const baseData = (): StorageData => ({
      groups: [createDefaultGroup()],
      filters: [],
      whitelist: [],
      snooze: { active: false },
      expandBlockPageDetails: false,
      rulesVersion: 1,
      schemaVersion: 2,
    });

    const makeFilter = (id: string): Filter => ({
      id,
      pattern: `${id}.example.com`,
      groupId: DEFAULT_GROUP_ID,
      enabled: true,
      matchMode: 'contains' as const,
    });

    it('retries against a fresh snapshot when another writer saved in between', async () => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync._data.set(STORAGE_KEY, baseData());

      const filterA = makeFilter('filter-a');
      const filterB = makeFilter('filter-b');
      let updaterCalls = 0;

      const result = await updateData((data) => {
        updaterCalls += 1;
        if (updaterCalls === 1) {
          // A concurrent writer lands between this load and the save.
          chromeMock.storage.sync._data.set(STORAGE_KEY, {
            ...baseData(),
            filters: [filterB],
            rulesVersion: 2,
          });
        }
        return { ...data, filters: [...data.filters, filterA] };
      });

      expect(updaterCalls).toBe(2);
      // Both writers' changes survive; nothing is clobbered.
      expect(result.filters).toEqual([filterB, filterA]);
      expect(
        (chromeMock.storage.sync._data.get(STORAGE_KEY) as { filters: unknown }).filters
      ).toEqual([filterB, filterA]);
    });

    it('gives up without clobbering when another writer keeps saving in between', async () => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync._data.set(STORAGE_KEY, baseData());
      let concurrentVersion = 1;

      await expect(
        updateData((data) => {
          concurrentVersion += 1;
          chromeMock.storage.sync._data.set(STORAGE_KEY, {
            ...baseData(),
            filters: [makeFilter('concurrent')],
            rulesVersion: concurrentVersion,
          });
          return { ...data, filters: [makeFilter('mine')] };
        })
      ).rejects.toThrow(SettingsSaveError);

      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
      expect(
        (chromeMock.storage.sync._data.get(STORAGE_KEY) as { filters: unknown }).filters
      ).toEqual([makeFilter('concurrent')]);
    });

    it('does not write when the updater returns the data unchanged', async () => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync._data.set(STORAGE_KEY, baseData());
      chromeMock.storage.sync.set.mockClear();

      await updateData((data) => data);

      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredTemporaryFilters', () => {
    it('deletes expired temporary filters and keeps everything else', async () => {
      const chromeMock = getChromeMock();
      const expired: Filter = {
        id: 'expired-temp',
        pattern: 'expired.example.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
        expiresAt: Date.now() - 1_000,
      };
      const active: Filter = {
        id: 'active-temp',
        pattern: 'active.example.com',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
        expiresAt: Date.now() + 60_000,
      };
      chromeMock.storage.sync._data.set(STORAGE_KEY, {
        groups: [createDefaultGroup()],
        filters: [expired, active],
        whitelist: [],
        snooze: { active: false },
        rulesVersion: 1,
        schemaVersion: 2,
      });

      const data = await purgeExpiredTemporaryFilters(await loadData());

      expect(data.filters).toEqual([active]);
      expect(
        (chromeMock.storage.sync._data.get(STORAGE_KEY) as { filters: unknown }).filters
      ).toEqual([active]);
    });

    it('does not write when nothing is expired', async () => {
      const chromeMock = getChromeMock();
      chromeMock.storage.sync._data.set(STORAGE_KEY, {
        groups: [createDefaultGroup()],
        filters: [],
        whitelist: [],
        snooze: { active: false },
        rulesVersion: 1,
      });
      chromeMock.storage.sync.set.mockClear();

      await purgeExpiredTemporaryFilters(await loadData());

      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('snooze', () => {
    it('stores snooze in sync and session storage and clears both', async () => {
      const chromeMock = getChromeMock();
      const snooze = { active: true, until: 1_234_567_890 };

      await setSnooze(snooze);
      expect((chromeMock.storage.sync._data.get(STORAGE_KEY) as StorageData).snooze).toEqual(
        snooze
      );
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual(snooze);

      await clearSnooze();
      expect((chromeMock.storage.sync._data.get(STORAGE_KEY) as StorageData).snooze).toEqual({
        active: false,
      });
      expect(chromeMock.storage.session._data.get('snooze_override')).toEqual({ active: false });
    });
  });

  describe('group and filter CRUD', () => {
    it('adds, updates, and removes groups and filters', async () => {
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
      await expect(deleteGroup(DEFAULT_GROUP_ID)).rejects.toThrow(
        'Cannot delete the default 24/7 group'
      );
    });

    it('should delete a group and reassign filters to default group', async () => {
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
