import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUrlDecision: vi.fn(),
  goBackFromActiveTab: vi.fn(),
  loadData: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    getUrlDecision: typeof mocks.getUrlDecision;
    goBackFromActiveTab: typeof mocks.goBackFromActiveTab;
  } => ({
    getUrlDecision: mocks.getUrlDecision,
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
  rulesVersion: 1,
};

describe('handleMessage', () => {
  beforeEach(() => {
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.getUrlDecision.mockResolvedValue({ action: 'allow', reason: 'no-match' });
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

  it('ignores unknown messages from this extension', () => {
    const sendResponse = vi.fn();

    expect(handleMessage({ type: 'UNKNOWN' }, { id: 'test-extension-id' }, sendResponse)).toBe(
      false
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
