import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  continueFromActiveTab: vi.fn(),
  continueFromBlockedPage: vi.fn(),
  continueFromTab: vi.fn(),
  getUrlDecision: vi.fn(),
  getBlockedPageStateByBlockId: vi.fn(),
  getBlockedPageStateForTab: vi.fn(),
  goBackFromActiveTab: vi.fn(),
  goBackFromTab: vi.fn(),
  loadData: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    getUrlDecision: typeof mocks.getUrlDecision;
    getBlockedPageStateByBlockId: typeof mocks.getBlockedPageStateByBlockId;
    getBlockedPageStateForTab: typeof mocks.getBlockedPageStateForTab;
    goBackFromActiveTab: typeof mocks.goBackFromActiveTab;
    goBackFromTab: typeof mocks.goBackFromTab;
    continueFromActiveTab: typeof mocks.continueFromActiveTab;
    continueFromBlockedPage: typeof mocks.continueFromBlockedPage;
    continueFromTab: typeof mocks.continueFromTab;
  } => ({
    continueFromActiveTab: mocks.continueFromActiveTab,
    continueFromBlockedPage: mocks.continueFromBlockedPage,
    continueFromTab: mocks.continueFromTab,
    getUrlDecision: mocks.getUrlDecision,
    getBlockedPageStateByBlockId: mocks.getBlockedPageStateByBlockId,
    getBlockedPageStateForTab: mocks.getBlockedPageStateForTab,
    goBackFromActiveTab: mocks.goBackFromActiveTab,
    goBackFromTab: mocks.goBackFromTab,
  }),
}));

vi.mock('../../../src/shared/api/storage', () => ({
  loadData: mocks.loadData,
}));

import { handleMessage } from '../../../src/background/handlers/messages';
import { MessageType } from '../../../src/shared/types';
import { DEFAULT_GROUP_ID } from '../../../src/shared/types';

const defaultData = {
  groups: [{ id: DEFAULT_GROUP_ID, name: '24/7', schedules: [], is24x7: true }],
  filters: [],
  whitelist: [],
  snooze: { active: false },
  rulesVersion: 1,
};

describe('handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.continueFromActiveTab.mockResolvedValue(false);
    mocks.continueFromBlockedPage.mockResolvedValue(false);
    mocks.continueFromTab.mockResolvedValue(false);
    mocks.getUrlDecision.mockResolvedValue({ action: 'allow', reason: 'no-match' });
    mocks.getBlockedPageStateByBlockId.mockResolvedValue({ status: 'unavailable' });
    mocks.getBlockedPageStateForTab.mockResolvedValue({ status: 'unavailable' });
    mocks.goBackFromActiveTab.mockResolvedValue(false);
    mocks.goBackFromTab.mockResolvedValue(false);
  });

  it('rejects messages from other extensions', () => {
    const sendResponse = vi.fn();

    expect(
      handleMessage({ type: MessageType.GET_DATA }, { id: 'someone-else' }, sendResponse)
    ).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('responds with storage data for GET_DATA messages', async () => {
    const sendResponse = vi.fn();

    expect(
      handleMessage({ type: MessageType.GET_DATA }, { id: 'test-extension-id' }, sendResponse)
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true, data: defaultData });
    });
  });

  it('responds to continue requests', async () => {
    mocks.continueFromTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CONTINUE_ACTIVE_TAB },
        {
          id: 'test-extension-id',
          tab: {
            id: 9,
            url: 'chrome-extension://test-extension-id/blocked.html?blockId=block-9',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ continued: true });
    });
    expect(mocks.continueFromTab).toHaveBeenCalledWith(
      9,
      'chrome-extension://test-extension-id/blocked.html?blockId=block-9',
      undefined
    );
    expect(mocks.continueFromActiveTab).not.toHaveBeenCalled();
  });

  it('uses the supplied block id for continue requests', async () => {
    mocks.continueFromTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CONTINUE_ACTIVE_TAB, blockId: 'block-9' },
        {
          id: 'test-extension-id',
          tab: {
            id: 9,
            url: 'chrome-extension://test-extension-id/blocked.html?blockId=block-9',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ continued: true });
    });
    expect(mocks.continueFromTab).toHaveBeenCalledWith(
      9,
      'chrome-extension://test-extension-id/blocked.html?blockId=block-9',
      'block-9'
    );
  });

  it('continues by block id when the sender tab is unavailable', async () => {
    mocks.continueFromBlockedPage.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CONTINUE_ACTIVE_TAB, blockId: 'block-9' },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ continued: true });
    });
    expect(mocks.continueFromBlockedPage).toHaveBeenCalledWith('block-9');
    expect(mocks.continueFromActiveTab).not.toHaveBeenCalled();
  });

  it('responds with blocked state for CHECK_URL messages', async () => {
    mocks.getUrlDecision.mockResolvedValue({
      action: 'block',
      filterId: 'filter-1',
      groupId: DEFAULT_GROUP_ID,
      reason: 'matched-filter',
    });
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CHECK_URL, url: 'https://blocked.com' },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ blocked: true });
    });
  });

  it('responds to go-back requests', async () => {
    mocks.goBackFromTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GO_BACK_ACTIVE_TAB },
        {
          id: 'test-extension-id',
          tab: { id: 10 } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ restored: true });
    });
    expect(mocks.goBackFromTab).toHaveBeenCalledWith(10);
    expect(mocks.goBackFromActiveTab).not.toHaveBeenCalled();
  });

  it('responds to blocked-page state requests', async () => {
    const blockedState = {
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockedAt: 1234,
      blockedBy: {
        filterId: 'filter-1',
        groupId: DEFAULT_GROUP_ID,
      },
      filter: {
        id: 'filter-1',
        pattern: 'blocked.com',
        matchMode: 'contains',
      },
      group: defaultData.groups[0]!,
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    };
    mocks.getBlockedPageStateForTab.mockResolvedValue({ status: 'blocked', state: blockedState });
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE },
        {
          id: 'test-extension-id',
          tab: {
            id: 7,
            url: 'chrome-extension://test-extension-id/blocked.html',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ status: 'blocked', state: blockedState });
    });
    expect(mocks.getBlockedPageStateForTab).toHaveBeenCalledWith(
      7,
      'chrome-extension://test-extension-id/blocked.html'
    );
  });

  it('prefers tab-scoped blocked-page state when sender tab is available', async () => {
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE, blockId: 'block-8' },
        {
          id: 'test-extension-id',
          tab: {
            id: 8,
            url: 'chrome-extension://test-extension-id/blocked.html?blockId=block-8',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(mocks.getBlockedPageStateForTab).toHaveBeenCalledWith(
        8,
        'chrome-extension://test-extension-id/blocked.html?blockId=block-8'
      );
    });
    expect(mocks.getBlockedPageStateByBlockId).not.toHaveBeenCalled();
  });

  it('responds to blocked-page state requests by block id without sender tab', async () => {
    const response = {
      status: 'blocked',
      state: {
        blockId: 'block-8',
        tabId: 8,
        targetUrl: 'https://blocked.com/focus',
        blockedAt: 1234,
        blockedBy: {
          filterId: 'filter-1',
          groupId: DEFAULT_GROUP_ID,
        },
        filter: {
          id: 'filter-1',
          pattern: 'blocked.com',
          matchMode: 'contains',
        },
        group: defaultData.groups[0]!,
        effectiveState: {
          filterEnabled: true,
          groupActive: true,
          snoozeActive: false,
        },
      },
    };
    mocks.getBlockedPageStateByBlockId.mockResolvedValue(response);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE, blockId: 'block-8' },
        {
          url: 'chrome-extension://test-extension-id/blocked.html?blockId=block-8',
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(response);
    });
    expect(mocks.getBlockedPageStateByBlockId).toHaveBeenCalledWith('block-8');
    expect(mocks.getBlockedPageStateForTab).not.toHaveBeenCalled();
  });

  it('returns unavailable blocked-page state when the sender tab is unavailable', async () => {
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ status: 'unavailable' });
    });
    expect(mocks.getBlockedPageStateForTab).not.toHaveBeenCalled();
    expect(mocks.getBlockedPageStateByBlockId).not.toHaveBeenCalled();
  });

  it('ignores unknown messages from this extension', () => {
    const sendResponse = vi.fn();

    expect(handleMessage({ type: 'UNKNOWN' }, { id: 'test-extension-id' }, sendResponse)).toBe(
      false
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
