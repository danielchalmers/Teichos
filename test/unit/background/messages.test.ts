import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUrlDecision: vi.fn(),
  goBackFromActiveTab: vi.fn(),
  goBackFromTab: vi.fn(),
  continueWarningFromActiveTab: vi.fn(),
  continueWarningFromTab: vi.fn(),
  loadData: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    getUrlDecision: typeof mocks.getUrlDecision;
    goBackFromActiveTab: typeof mocks.goBackFromActiveTab;
    goBackFromTab: typeof mocks.goBackFromTab;
    continueWarningFromActiveTab: typeof mocks.continueWarningFromActiveTab;
    continueWarningFromTab: typeof mocks.continueWarningFromTab;
  } => ({
    getUrlDecision: mocks.getUrlDecision,
    goBackFromActiveTab: mocks.goBackFromActiveTab,
    goBackFromTab: mocks.goBackFromTab,
    continueWarningFromActiveTab: mocks.continueWarningFromActiveTab,
    continueWarningFromTab: mocks.continueWarningFromTab,
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
  blockType: 'block',
  snooze: { active: false },
  rulesVersion: 1,
};

describe('handleMessage', () => {
  beforeEach(() => {
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.getUrlDecision.mockResolvedValue({ action: 'allow', reason: 'no-match' });
    mocks.goBackFromActiveTab.mockResolvedValue(false);
    mocks.goBackFromTab.mockResolvedValue(false);
    mocks.continueWarningFromActiveTab.mockResolvedValue(false);
    mocks.continueWarningFromTab.mockResolvedValue(false);
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
        { id: 'test-extension-id', tab: { id: 4 } as chrome.tabs.Tab },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ restored: true });
    });
    expect(mocks.goBackFromTab).toHaveBeenCalledWith(4);
  });

  it('responds to warning-continue requests', async () => {
    mocks.continueWarningFromTab.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CONTINUE_ACTIVE_TAB_WARNING },
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
      expect(sendResponse).toHaveBeenCalledWith({ continued: true });
    });
    expect(mocks.continueWarningFromTab).toHaveBeenCalledWith(
      7,
      'chrome-extension://test-extension-id/src/blocked/index.html'
    );
  });

  it('ignores unknown messages from this extension', () => {
    const sendResponse = vi.fn();

    expect(handleMessage({ type: 'UNKNOWN' }, { id: 'test-extension-id' }, sendResponse)).toBe(
      false
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
