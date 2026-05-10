import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  updateTabUrl: vi.fn(),
  setLastAllowedUrl: vi.fn(),
  isSnoozeBypassActive: vi.fn(),
}));

vi.mock('../../../src/shared/api/storage', () => ({
  loadData: mocks.loadData,
}));

vi.mock('../../../src/shared/api/tabs', () => ({
  updateTabUrl: mocks.updateTabUrl,
}));

vi.mock('../../../src/shared/api/session', () => ({
  setLastAllowedUrl: mocks.setLastAllowedUrl,
}));

vi.mock('../../../src/background/snoozeBypass', () => ({
  isSnoozeBypassActive: mocks.isSnoozeBypassActive,
}));

import { handleBeforeNavigate } from '../../../src/background/handlers/navigation';
import { PAGES } from '../../../src/shared/constants';
import { DEFAULT_GROUP_ID } from '../../../src/shared/types';

const defaultData = {
  groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
  filters: [
    {
      id: 'filter-1',
      pattern: 'blocked.com',
      groupId: DEFAULT_GROUP_ID,
      enabled: true,
      matchMode: 'contains' as const,
    },
  ],
  whitelist: [],
  snooze: { active: false },
};

describe('handleBeforeNavigate', () => {
  beforeEach(() => {
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.updateTabUrl.mockResolvedValue(undefined);
    mocks.setLastAllowedUrl.mockResolvedValue(undefined);
    mocks.isSnoozeBypassActive.mockResolvedValue(false);
  });

  it('ignores non-main-frame navigations', async () => {
    await handleBeforeNavigate({ frameId: 2, tabId: 4, url: 'https://blocked.com' });

    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.updateTabUrl).not.toHaveBeenCalled();
  });

  it('ignores internal URLs', async () => {
    await handleBeforeNavigate({ frameId: 0, tabId: 4, url: 'chrome://settings' });

    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.setLastAllowedUrl).not.toHaveBeenCalled();
  });

  it('stores the last allowed URL when snooze bypass is active', async () => {
    mocks.isSnoozeBypassActive.mockResolvedValue(true);

    await handleBeforeNavigate({ frameId: 0, tabId: 7, url: 'https://allowed.com' });

    expect(mocks.setLastAllowedUrl).toHaveBeenCalledWith(7, 'https://allowed.com');
    expect(mocks.updateTabUrl).not.toHaveBeenCalled();
  });

  it('redirects blocked URLs to the blocked page', async () => {
    await handleBeforeNavigate({ frameId: 0, tabId: 9, url: 'https://blocked.com/page' });

    expect(mocks.updateTabUrl).toHaveBeenCalledWith(
      9,
      `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://blocked.com/page')}`
    );
    expect(mocks.setLastAllowedUrl).not.toHaveBeenCalled();
  });

  it('stores allowed URLs when no filter matches', async () => {
    await handleBeforeNavigate({ frameId: 0, tabId: 3, url: 'https://allowed.com' });

    expect(mocks.setLastAllowedUrl).toHaveBeenCalledWith(3, 'https://allowed.com');
    expect(mocks.updateTabUrl).not.toHaveBeenCalled();
  });

  it('restores blocked-page target navigation while snoozed', async () => {
    mocks.isSnoozeBypassActive.mockResolvedValue(true);
    const blockedUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent('https://example.com/focus')}`;

    await handleBeforeNavigate({ frameId: 0, tabId: 11, url: blockedUrl });

    expect(mocks.setLastAllowedUrl).toHaveBeenCalledWith(11, 'https://example.com/focus');
    expect(mocks.updateTabUrl).toHaveBeenCalledWith(11, 'https://example.com/focus');
  });

  it('does not restore invalid blocked-page target URLs', async () => {
    const blockedUrl = `chrome-extension://test-extension-id/${PAGES.BLOCKED}?url=${encodeURIComponent(`chrome-extension://test-extension-id/${PAGES.BLOCKED}`)}`;

    await handleBeforeNavigate({ frameId: 0, tabId: 12, url: blockedUrl });

    expect(mocks.setLastAllowedUrl).not.toHaveBeenCalled();
    expect(mocks.updateTabUrl).not.toHaveBeenCalled();
  });
});
