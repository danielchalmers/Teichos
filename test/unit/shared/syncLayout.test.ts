import { describe, expect, it } from 'vitest';

import {
  decodeSettings,
  encodeSettings,
  hasSettingsChange,
  isSettingsKey,
  SPLIT_INDEX_KEY,
  splitPartKey,
  SYNC_ITEM_LIMIT_BYTES,
} from '../../../src/shared/storage/syncLayout';
import { DEFAULT_GROUP_ID, STORAGE_KEY, type StorageData } from '../../../src/shared/types';

function createData(filterCount: number, rulesVersion = 1): StorageData {
  return {
    groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true, enabled: true }],
    // Quotes, backslashes and multi-byte text all store larger than their length.
    filters: Array.from({ length: filterCount }, (_, index) => ({
      id: `filter-${String(index).padStart(4, '0')}-${'x'.repeat(16)}`,
      pattern: `site-${String(index)}.example.com`,
      groupId: DEFAULT_GROUP_ID,
      enabled: true,
      matchMode: 'domain' as const,
      description: `Site "${String(index)}" \\ ブロック 🚫`,
    })),
    whitelist: [],
    snooze: { active: false },
    rulesVersion,
    schemaVersion: 2,
  };
}

/** How chrome.storage.sync measures an item against QUOTA_BYTES_PER_ITEM. */
function storedBytes(key: string, value: unknown): number {
  return key.length + new TextEncoder().encode(JSON.stringify(value)).length;
}

describe('encodeSettings', () => {
  it('stores settings that fit in one item exactly as before', () => {
    const data = createData(10);

    const { items, staleKeys } = encodeSettings(data, [STORAGE_KEY]);

    expect(items).toEqual({ [STORAGE_KEY]: data });
    expect(staleKeys).toEqual([]);
  });

  it('splits settings that outgrow one item into parts that each fit', () => {
    const data = createData(300);
    expect(storedBytes(STORAGE_KEY, data)).toBeGreaterThan(SYNC_ITEM_LIMIT_BYTES);

    const { items } = encodeSettings(data, [], () => 'revision-1');

    expect(items[STORAGE_KEY]).toBeUndefined();
    const parts = Object.entries(items).filter(([key]) => key !== SPLIT_INDEX_KEY);
    expect(parts.length).toBeGreaterThan(1);
    for (const [key, value] of Object.entries(items)) {
      expect(storedBytes(key, value)).toBeLessThanOrEqual(SYNC_ITEM_LIMIT_BYTES);
    }
    expect(items[SPLIT_INDEX_KEY]).toEqual({
      revision: 'revision-1',
      parts: parts.length,
      rulesVersion: data.rulesVersion,
    });
    expect(decodeSettings(items)).toEqual({ raw: data, latestRulesVersion: 1, complete: true });
  });

  it('never ends a part between the two halves of a character', () => {
    const data = { ...createData(0), groups: [], whitelist: [], note: '🚫'.repeat(6000) };

    const { items } = encodeSettings(data as StorageData, []);

    for (const [key, value] of Object.entries(items)) {
      if (key === SPLIT_INDEX_KEY) continue;
      const { text } = value as { text: string };
      const lastCode = text.charCodeAt(text.length - 1);
      expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
    }
    expect(decodeSettings(items).raw).toEqual(data);
  });

  it('marks parts past the new count, or every split item once settings fit again, as stale', () => {
    const storedKeys = [STORAGE_KEY, SPLIT_INDEX_KEY, splitPartKey(0), splitPartKey(1)];
    storedKeys.push(splitPartKey(2), splitPartKey(3), splitPartKey(4), splitPartKey(50));

    const grown = encodeSettings(createData(300), storedKeys);
    expect(grown.staleKeys).toContain(splitPartKey(50));
    expect(grown.staleKeys).not.toContain(SPLIT_INDEX_KEY);

    // The single item stays: it is the copy older versions read, and a newer copy outranks it.
    const shrunk = encodeSettings(createData(5), storedKeys);
    expect(shrunk.staleKeys).toEqual(storedKeys.filter((key) => key !== STORAGE_KEY));
  });
});

describe('decodeSettings', () => {
  it('reads nothing as no settings', () => {
    expect(decodeSettings({})).toEqual({
      raw: undefined,
      latestRulesVersion: undefined,
      complete: true,
    });
  });

  it('takes whichever complete copy has the higher rulesVersion', () => {
    const olderSingle = createData(1, 4);
    const newerSplit = createData(300, 5);
    const split = encodeSettings(newerSplit, []).items;

    expect(decodeSettings({ [STORAGE_KEY]: olderSingle, ...split }).raw).toEqual(newerSplit);
    expect(decodeSettings({ [STORAGE_KEY]: createData(2, 6), ...split }).raw).toEqual(
      createData(2, 6)
    );
  });

  it('prefers the split copy on a tie, since only an older version can produce one', () => {
    const split = createData(300, 5);

    const decoded = decodeSettings({
      [STORAGE_KEY]: createData(1, 5),
      ...encodeSettings(split, []).items,
    });

    expect(decoded.raw).toEqual(split);
  });

  it('keeps the older complete copy while a newer split copy is still arriving', () => {
    const olderSingle = createData(1, 4);
    const newerItems = { ...encodeSettings(createData(300, 5), [], () => 'new').items };
    const previousPart = encodeSettings(createData(300, 3), [], () => 'old').items[splitPartKey(1)];
    newerItems[splitPartKey(1)] = previousPart;

    expect(decodeSettings({ [STORAGE_KEY]: olderSingle, ...newerItems })).toEqual({
      raw: olderSingle,
      latestRulesVersion: 5,
      complete: false,
    });

    const missingPart = Object.fromEntries(
      Object.entries(newerItems).filter(([key]) => key !== splitPartKey(1))
    );
    expect(decodeSettings(missingPart)).toEqual({
      raw: undefined,
      latestRulesVersion: 5,
      complete: false,
    });
  });
});

describe('settings keys', () => {
  it('recognizes both layouts and nothing else', () => {
    expect(isSettingsKey(STORAGE_KEY)).toBe(true);
    expect(isSettingsKey(SPLIT_INDEX_KEY)).toBe(true);
    expect(isSettingsKey(splitPartKey(12))).toBe(true);
    expect(isSettingsKey(`${STORAGE_KEY}_backup`)).toBe(false);
    expect(isSettingsKey('snooze_override')).toBe(false);

    expect(hasSettingsChange({ [splitPartKey(3)]: {} })).toBe(true);
    expect(hasSettingsChange({ other: {} })).toBe(false);
  });
});
