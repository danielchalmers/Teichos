import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTab,
  getActiveTab,
  getTab,
  queryTabs,
  removeTabs,
  updateTab,
  updateTabUrl,
} from '../../../src/shared/api/tabs';
import { createMockTab, getChromeMock } from '../../fixtures/chrome-mocks';

describe('shared/api/tabs', () => {
  beforeEach(() => {
    const chromeMock = getChromeMock();
    chromeMock.runtime.lastError = undefined;
    chromeMock.tabs.query.mockImplementation(
      (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([createMockTab({ id: 1, url: 'https://example.com' })]);
      }
    );
    chromeMock.tabs.update.mockImplementation(
      (
        tabId: number,
        updateProps: chrome.tabs.UpdateProperties,
        callback?: (tab: chrome.tabs.Tab | undefined) => void
      ) => {
        callback?.(createMockTab({ id: tabId, ...updateProps }));
      }
    );
    chromeMock.tabs.create.mockImplementation(
      (createProps: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        callback?.(createMockTab({ id: 2, ...createProps }));
      }
    );
    chromeMock.tabs.remove.mockImplementation((_: number | number[], callback?: () => void) => {
      callback?.();
    });
    chromeMock.tabs.get.mockImplementation(
      (tabId: number, callback?: (tab: chrome.tabs.Tab) => void) => {
        callback?.(createMockTab({ id: tabId, url: 'https://example.com/tab' }));
      }
    );
  });

  it('wraps chrome.tabs callbacks in promises', async () => {
    await expect(queryTabs({ active: true })).resolves.toMatchObject([
      { id: 1, url: 'https://example.com' },
    ]);
    await expect(updateTab(4, { active: true })).resolves.toMatchObject({ id: 4, active: true });
    await expect(createTab({ url: 'https://created.example' })).resolves.toMatchObject({
      id: 2,
      url: 'https://created.example',
    });
    await expect(getTab(9)).resolves.toMatchObject({ id: 9, url: 'https://example.com/tab' });
  });

  it('supports convenience helpers', async () => {
    await expect(updateTabUrl(3, 'https://updated.example')).resolves.toMatchObject({
      id: 3,
      url: 'https://updated.example',
    });
    await expect(getActiveTab()).resolves.toMatchObject({ id: 1, url: 'https://example.com' });
    await expect(removeTabs([])).resolves.toBeUndefined();
    expect(getChromeMock().tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects when chrome.runtime.lastError is set', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.query.mockImplementation(
      (_: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        chromeMock.runtime.lastError = { message: 'query failed' };
        callback?.([]);
        chromeMock.runtime.lastError = undefined;
      }
    );

    await expect(queryTabs({})).rejects.toThrow('query failed');
  });

  it('rejects updateTab when the callback returns no tab', async () => {
    getChromeMock().tabs.update.mockImplementation(
      (
        _tabId: number,
        _updateProps: chrome.tabs.UpdateProperties,
        callback?: (tab: chrome.tabs.Tab | undefined) => void
      ) => {
        callback?.(undefined);
      }
    );

    await expect(updateTab(5, { active: true })).rejects.toThrow(
      'chrome.tabs.update returned undefined tab'
    );
  });

  it('rejects removeTabs when chrome reports an error', async () => {
    const chromeMock = getChromeMock();
    chromeMock.tabs.remove.mockImplementation((_: number | number[], callback?: () => void) => {
      chromeMock.runtime.lastError = { message: 'remove failed' };
      callback?.();
      chromeMock.runtime.lastError = undefined;
    });

    await expect(removeTabs([1, 2])).rejects.toThrow('remove failed');
  });
});
