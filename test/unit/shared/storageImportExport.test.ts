import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultGroup,
  exportData,
  importData,
  parseImportedData,
  serializeDataForExport,
} from '../../../src/shared/api/storage';
import { getSessionSnooze } from '../../../src/shared/api/session';
import type { StorageData } from '../../../src/shared/types';
import { DEFAULT_GROUP_ID, STORAGE_KEY } from '../../../src/shared/types';
import { getChromeMock } from '../../fixtures/chrome-mocks';

function createSampleData(): StorageData {
  return {
    groups: [
      createDefaultGroup(),
      {
        id: 'work-hours',
        name: 'Work Hours',
        is24x7: false,
        enabled: true,
        schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
      },
    ],
    filters: [
      {
        id: 'contains-filter',
        pattern: 'news.example.test',
        groupId: DEFAULT_GROUP_ID,
        enabled: true,
        matchMode: 'contains',
        description: 'News',
      },
      {
        id: 'regex-filter',
        pattern: '^https://work\\.example\\.test/tasks/\\d+$',
        groupId: 'work-hours',
        enabled: true,
        matchMode: 'regex',
      },
    ],
    whitelist: [
      {
        id: 'allow-docs',
        pattern: 'https://work.example.test/docs',
        groupId: 'work-hours',
        enabled: true,
        matchMode: 'exact',
      },
    ],
    snooze: { active: true, until: 1_234_567_890 },
    rulesVersion: 4,
  };
}

describe('storage import/export', () => {
  beforeEach(() => {
    getChromeMock().storage.sync._reset();
    getChromeMock().storage.session._reset();
  });

  it('serializes exported data as formatted json', () => {
    const serialized = serializeDataForExport(createSampleData());

    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized)).toEqual(createSampleData());
  });

  it('parses valid imports and adds the default group when missing', () => {
    const parsed = parseImportedData(
      JSON.stringify({
        groups: [
          {
            id: 'work-hours',
            name: 'Work Hours',
            is24x7: false,
            schedules: [{ daysOfWeek: [1, 2], startTime: '09:00', endTime: '17:00' }],
          },
        ],
        filters: [
          {
            id: 'work-filter',
            pattern: 'work.example.test',
            groupId: 'work-hours',
            enabled: true,
            matchMode: 'contains',
          },
        ],
        whitelist: [],
      })
    );

    expect(parsed.groups.map((group) => group.id)).toEqual([DEFAULT_GROUP_ID, 'work-hours']);
  });

  it('normalizes legacy whitelist imports', () => {
    const parsed = parseImportedData(
      JSON.stringify({
        filters: [],
        whitelist: [{ id: 'legacy-whitelist', pattern: 'allowed.example.test', enabled: true }],
      })
    );

    expect(parsed).toMatchObject({
      groups: [createDefaultGroup()],
      whitelist: [
        {
          id: 'legacy-whitelist',
          pattern: 'allowed.example.test',
          enabled: true,
          groupId: DEFAULT_GROUP_ID,
          matchMode: 'contains',
        },
      ],
      snooze: { active: false },
      rulesVersion: 0,
    });
  });

  it('rejects invalid json imports', () => {
    expect(() => parseImportedData('{')).toThrow('Settings file is not valid JSON.');
  });

  it('rejects imports with duplicate ids', () => {
    expect(() =>
      parseImportedData(
        JSON.stringify({
          groups: [createDefaultGroup(), { ...createDefaultGroup() }],
          filters: [],
          whitelist: [],
        })
      )
    ).toThrow('Imported settings contain duplicate group ids.');
  });

  it('rejects imports with unknown group references', () => {
    expect(() =>
      parseImportedData(
        JSON.stringify({
          groups: [createDefaultGroup()],
          filters: [
            {
              id: 'orphaned-filter',
              pattern: 'orphaned.example.test',
              groupId: 'missing-group',
              enabled: true,
              matchMode: 'contains',
            },
          ],
          whitelist: [],
        })
      )
    ).toThrow('Imported filter "orphaned-filter" references an unknown group.');
  });

  it('rejects imports with invalid regex patterns', () => {
    expect(() =>
      parseImportedData(
        JSON.stringify({
          groups: [createDefaultGroup()],
          filters: [
            {
              id: 'broken-filter',
              pattern: '(',
              groupId: DEFAULT_GROUP_ID,
              enabled: true,
              matchMode: 'regex',
            },
          ],
          whitelist: [],
        })
      )
    ).toThrow('Imported filter "broken-filter" has an invalid regex pattern.');
  });

  it('imports settings, increments rules version, and syncs session snooze', async () => {
    getChromeMock().storage.sync._data.set(STORAGE_KEY, {
      ...createSampleData(),
      rulesVersion: 9,
    });

    const imported = await importData(JSON.stringify(createSampleData()));
    const stored = getChromeMock().storage.sync._data.get(STORAGE_KEY) as StorageData;

    expect(imported).toEqual(createSampleData());
    expect(stored.rulesVersion).toBe(10);
    expect(await getSessionSnooze()).toEqual(createSampleData().snooze);
  });

  it('exports the currently stored settings', async () => {
    getChromeMock().storage.sync._data.set(STORAGE_KEY, createSampleData());

    const serialized = await exportData();

    expect(JSON.parse(serialized)).toEqual(createSampleData());
  });
});
