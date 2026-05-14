import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPTIONS_ROUTE_INTENT } from '../../../src/shared/constants';

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

import { openOptionsPageWithParams } from '../../../src/shared/api/runtime';

describe('shared/api/runtime', () => {
  beforeEach(() => {
    (chrome.storage.session as typeof chrome.storage.session & { _reset: () => void })._reset();
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();
    tabsMocks.queryTabs.mockResolvedValue([]);
    tabsMocks.updateTab.mockResolvedValue({ id: 1, active: true });
    tabsMocks.createTab.mockResolvedValue({
      id: 2,
      url: 'chrome-extension://test-extension-id/tabs/settings.html',
    });
    tabsMocks.removeTabs.mockResolvedValue(undefined);
  });

  it('creates an options tab when one does not already exist', async () => {
    await openOptionsPageWithParams({ panel: 'filters', mode: 'new' });

    expect(tabsMocks.createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/tabs/settings.html',
    });
    await expect(chrome.storage.session.get(OPTIONS_ROUTE_INTENT)).resolves.toEqual({
      [OPTIONS_ROUTE_INTENT]: { panel: 'filters', mode: 'new' },
    });
  });

  it('focuses an existing options tab and removes duplicates', async () => {
    tabsMocks.queryTabs.mockResolvedValue([
      { id: 10, url: 'chrome-extension://test-extension-id/tabs/settings.html' },
      { id: 11, url: 'chrome-extension://test-extension-id/tabs/settings.html#stale=1' },
    ]);

    await openOptionsPageWithParams({ panel: 'filters' });

    expect(tabsMocks.removeTabs).toHaveBeenCalledWith([11]);
    expect(tabsMocks.updateTab).toHaveBeenCalledWith(10, {
      active: true,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'OPEN_OPTIONS_ROUTE',
      params: { panel: 'filters' },
    });
    expect(tabsMocks.updateTab).not.toHaveBeenCalledWith(10, {
      active: true,
      url: 'chrome-extension://test-extension-id/tabs/settings.html#panel=filters',
    });
  });

  it('returns undefined when the existing options tab has no id', async () => {
    tabsMocks.queryTabs.mockResolvedValue([
      { url: 'chrome-extension://test-extension-id/tabs/settings.html' },
    ]);

    await expect(openOptionsPageWithParams({ panel: 'filters' })).resolves.toBeUndefined();
    expect(tabsMocks.updateTab).not.toHaveBeenCalled();
  });
});
