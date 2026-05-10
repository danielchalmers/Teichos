import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsMocks = vi.hoisted(() => ({
  queryTabs: vi.fn(),
  updateTab: vi.fn(),
  createTab: vi.fn(),
  removeTabs: vi.fn(),
}));

vi.mock('../../../src/shared/api/tabs', () => ({
  queryTabs: tabsMocks.queryTabs,
  updateTab: tabsMocks.updateTab,
  createTab: tabsMocks.createTab,
  removeTabs: tabsMocks.removeTabs,
}));

import {
  getExtensionId,
  getExtensionUrl,
  openOptionsPage,
  openOptionsPageWithParams,
} from '../../../src/shared/api/runtime';

describe('shared/api/runtime', () => {
  beforeEach(() => {
    tabsMocks.queryTabs.mockResolvedValue([]);
    tabsMocks.updateTab.mockResolvedValue({ id: 1, active: true });
    tabsMocks.createTab.mockResolvedValue({ id: 2, url: 'chrome-extension://test-extension-id/options/index.html' });
    tabsMocks.removeTabs.mockResolvedValue(undefined);
  });

  it('returns extension URLs and ids from chrome.runtime', () => {
    expect(getExtensionUrl('popup/index.html')).toBe(
      'chrome-extension://test-extension-id/popup/index.html'
    );
    expect(getExtensionId()).toBe('test-extension-id');
  });

  it('opens the native options page', async () => {
    await openOptionsPage();

    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('creates an options tab when one does not already exist', async () => {
    await openOptionsPageWithParams({ panel: 'filters', mode: 'new' });

    expect(tabsMocks.createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/options/index.html?panel=filters&mode=new',
    });
  });

  it('focuses an existing options tab and removes duplicates', async () => {
    tabsMocks.queryTabs.mockResolvedValue([
      { id: 10, url: 'chrome-extension://test-extension-id/options/index.html' },
      { id: 11, url: 'chrome-extension://test-extension-id/options/index.html?stale=1' },
    ]);

    await openOptionsPageWithParams({ panel: 'filters' });

    expect(tabsMocks.removeTabs).toHaveBeenCalledWith([11]);
    expect(tabsMocks.updateTab).toHaveBeenCalledWith(10, {
      active: true,
      url: 'chrome-extension://test-extension-id/options/index.html?panel=filters',
    });
  });

  it('returns undefined when the existing options tab has no id', async () => {
    tabsMocks.queryTabs.mockResolvedValue([
      { url: 'chrome-extension://test-extension-id/options/index.html' },
    ]);

    await expect(openOptionsPageWithParams({ panel: 'filters' })).resolves.toBeUndefined();
    expect(tabsMocks.updateTab).not.toHaveBeenCalled();
  });
});
