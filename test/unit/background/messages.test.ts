import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  continueFromActiveTab: vi.fn(),
  getUrlDecision: vi.fn(),
  getBlockedPageStateByBlockId: vi.fn(),
  getFreshBlockedPageState: vi.fn(),
  goBackFromActiveTab: vi.fn(),
  loadData: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    getUrlDecision: typeof mocks.getUrlDecision;
    getBlockedPageStateByBlockId: typeof mocks.getBlockedPageStateByBlockId;
    getFreshBlockedPageState: typeof mocks.getFreshBlockedPageState;
    goBackFromActiveTab: typeof mocks.goBackFromActiveTab;
    continueFromActiveTab: typeof mocks.continueFromActiveTab;
  } => ({
    continueFromActiveTab: mocks.continueFromActiveTab,
    getUrlDecision: mocks.getUrlDecision,
    getBlockedPageStateByBlockId: mocks.getBlockedPageStateByBlockId,
    getFreshBlockedPageState: mocks.getFreshBlockedPageState,
    goBackFromActiveTab: mocks.goBackFromActiveTab,
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
  blockType: 'block' as const,
  rulesVersion: 1,
};

describe('handleMessage', () => {
  beforeEach(() => {
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.continueFromActiveTab.mockResolvedValue(false);
    mocks.getUrlDecision.mockResolvedValue({ action: 'allow', reason: 'no-match' });
    mocks.getBlockedPageStateByBlockId.mockResolvedValue({ status: 'unavailable' });
    mocks.getFreshBlockedPageState.mockResolvedValue({ status: 'unavailable' });
    mocks.goBackFromActiveTab.mockResolvedValue(false);
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
    mocks.continueFromActiveTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CONTINUE_ACTIVE_TAB },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ continued: true });
    });
  });

  it('responds with blocked state for CHECK_URL messages', async () => {
    mocks.getUrlDecision.mockResolvedValue({
      action: 'block',
      filterId: 'filter-1',
      groupId: DEFAULT_GROUP_ID,
      blockType: 'block',
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
    mocks.goBackFromActiveTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GO_BACK_ACTIVE_TAB },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ restored: true });
    });
  });

  it('responds to blocked-page state requests', async () => {
    const blockedState = {
      blockId: 'block-7',
      tabId: 7,
      targetUrl: 'https://blocked.com/focus',
      blockType: 'block',
      blockedAt: 1234,
      rulesVersion: 2,
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
    mocks.getFreshBlockedPageState.mockResolvedValue({ status: 'blocked', state: blockedState });
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE },
        {
          id: 'test-extension-id',
          tab: {
            id: 7,
            url: 'chrome-extension://test-extension-id/src/blocked/index.html',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ status: 'blocked', state: blockedState });
    });
    expect(mocks.getFreshBlockedPageState).toHaveBeenCalledWith(
      7,
      'chrome-extension://test-extension-id/src/blocked/index.html'
    );
  });

  it('prefers fresh blocked-page state when sender tab is available', async () => {
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE, blockId: 'block-8' },
        {
          id: 'test-extension-id',
          tab: {
            id: 8,
            url: 'chrome-extension://test-extension-id/src/blocked/index.html?blockId=block-8',
          } as chrome.tabs.Tab,
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(mocks.getFreshBlockedPageState).toHaveBeenCalledWith(
        8,
        'chrome-extension://test-extension-id/src/blocked/index.html?blockId=block-8'
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
        blockType: 'block',
        blockedAt: 1234,
        rulesVersion: 2,
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
          url: 'chrome-extension://test-extension-id/src/blocked/index.html?blockId=block-8',
        },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(response);
    });
    expect(mocks.getBlockedPageStateByBlockId).toHaveBeenCalledWith('block-8');
    expect(mocks.getFreshBlockedPageState).not.toHaveBeenCalled();
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
    expect(mocks.getFreshBlockedPageState).not.toHaveBeenCalled();
    expect(mocks.getBlockedPageStateByBlockId).not.toHaveBeenCalled();
  });

  it('forwards allowed blocked-page state responses', async () => {
    const response = { status: 'allowed', targetUrl: 'https://allowed.com/focus' };
    mocks.getFreshBlockedPageState.mockResolvedValue(response);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.GET_BLOCKED_PAGE_STATE },
        { id: 'test-extension-id', tab: { id: 8 } as chrome.tabs.Tab },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(response);
    });
  });

  it('ignores unknown messages from this extension', () => {
    const sendResponse = vi.fn();

    expect(handleMessage({ type: 'UNKNOWN' }, { id: 'test-extension-id' }, sendResponse)).toBe(
      false
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
