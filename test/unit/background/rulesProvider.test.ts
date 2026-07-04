import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RulesProvider } from '../../../src/background/rulesProvider';
import { createDefaultGroup } from '../../../src/shared/api/storage';
import { createFilteringEngine } from '../../../src/shared/filtering/engine';
import { DEFAULT_GROUP_ID, STORAGE_KEY, type StorageData } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [createDefaultGroup()],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    blockType: overrides.blockType ?? 'block',
    rulesVersion: overrides.rulesVersion ?? 0,
  };
}

describe('RulesProvider', () => {
  beforeEach(() => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._reset();
    vi.clearAllMocks();
  });

  it('reads storage and builds an engine on first load', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'filter-1',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 2,
      })
    );
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ createEngine });

    const rules = await provider.loadCurrentRules();

    expect(chromeMock.storage.sync.get).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(rules.engine.evaluate('https://blocked.com')).toEqual({
      action: 'block',
      filterId: 'filter-1',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
  });

  it('reuses cached rules when normalized storage is unchanged', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        rulesVersion: 1,
      })
    );
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ createEngine });

    const first = await provider.loadCurrentRules();
    const second = await provider.loadCurrentRules();

    expect(chromeMock.storage.sync.get).toHaveBeenCalledTimes(2);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('shares in-flight loads so unchanged concurrent reads build one engine', async () => {
    let resolveStorageData: ((data: StorageData) => void) | undefined;
    const loadStorageData = vi.fn(
      () =>
        new Promise<StorageData>((resolve) => {
          resolveStorageData = resolve;
        })
    );
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ loadStorageData, createEngine });

    const firstLoad = provider.loadCurrentRules();
    const secondLoad = provider.loadCurrentRules();
    resolveStorageData?.(createStorageData({ rulesVersion: 1 }));

    const [first, second] = await Promise.all([firstLoad, secondLoad]);

    expect(loadStorageData).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('starts a fresh load after invalidate during an in-flight read', async () => {
    const resolves: ((data: StorageData) => void)[] = [];
    const loadStorageData = vi.fn(
      () =>
        new Promise<StorageData>((resolve) => {
          resolves.push(resolve);
        })
    );
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ loadStorageData, createEngine });

    const staleLoad = provider.loadCurrentRules();
    provider.invalidate();
    const refreshedLoad = provider.loadCurrentRules();

    expect(loadStorageData).toHaveBeenCalledTimes(2);

    resolves[0]?.(
      createStorageData({
        filters: [
          {
            id: 'stale-filter',
            pattern: 'stale.example',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 1,
      })
    );
    resolves[1]?.(
      createStorageData({
        filters: [
          {
            id: 'fresh-filter',
            pattern: 'fresh.example',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 2,
      })
    );

    const [staleRules, refreshedRules, cachedRules] = await Promise.all([
      staleLoad,
      refreshedLoad,
      provider.loadCurrentRules(),
    ]);

    expect(loadStorageData).toHaveBeenCalledTimes(2);
    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(staleRules.engine.evaluate('https://stale.example')).toEqual({
      action: 'block',
      filterId: 'stale-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
    expect(refreshedRules.engine.evaluate('https://fresh.example')).toEqual({
      action: 'block',
      filterId: 'fresh-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
    expect(cachedRules.engine.evaluate('https://fresh.example')).toEqual({
      action: 'block',
      filterId: 'fresh-filter',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
    expect(cachedRules.engine.evaluate('https://stale.example')).toEqual({
      action: 'allow',
      reason: 'no-match',
    });
  });

  it('reloads rules when storage changes', async () => {
    const chromeMock = getChromeMock();
    chromeMock.storage.sync._data.set(STORAGE_KEY, createStorageData({ rulesVersion: 1 }));
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ createEngine });

    const first = await provider.loadCurrentRules();
    chromeMock.storage.sync._data.set(
      STORAGE_KEY,
      createStorageData({
        filters: [
          {
            id: 'filter-2',
            pattern: 'blocked.com',
            groupId: DEFAULT_GROUP_ID,
            enabled: true,
            matchMode: 'contains',
          },
        ],
        rulesVersion: 2,
      })
    );

    const second = await provider.loadCurrentRules();

    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second.engine.evaluate('https://blocked.com')).toEqual({
      action: 'block',
      filterId: 'filter-2',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
      reason: 'matched-filter',
    });
  });

  it('returns normalized default rules for empty storage without writing storage', async () => {
    const chromeMock = getChromeMock();
    const createEngine = vi.fn((data: StorageData) => createFilteringEngine(data));
    const provider = new RulesProvider({ createEngine });

    const rules = await provider.loadCurrentRules();
    const cachedRules = await provider.loadCurrentRules();

    expect(rules.data).toEqual({
      groups: [createDefaultGroup()],
      filters: [],
      whitelist: [],
      snooze: { active: false },
      blockType: 'block',
      expandBlockPageDetails: false,
      rulesVersion: 0,
    });
    expect(cachedRules).toBe(rules);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    expect(chromeMock.storage.sync._data.has(STORAGE_KEY)).toBe(false);
  });
});
