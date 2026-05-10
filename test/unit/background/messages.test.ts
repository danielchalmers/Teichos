import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  isSnoozeBypassActive: vi.fn(),
}));

vi.mock('../../../src/shared/api/storage', () => ({
  loadData: mocks.loadData,
}));

vi.mock('../../../src/background/snoozeBypass', () => ({
  isSnoozeBypassActive: mocks.isSnoozeBypassActive,
}));

import { handleMessage } from '../../../src/background/handlers/messages';
import { MessageType } from '../../../src/shared/types';
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

describe('handleMessage', () => {
  beforeEach(() => {
    mocks.loadData.mockResolvedValue(defaultData);
    mocks.isSnoozeBypassActive.mockResolvedValue(false);
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

  it('responds with blocked false while snooze bypass is active', async () => {
    mocks.isSnoozeBypassActive.mockResolvedValue(true);
    const sendResponse = vi.fn();

    expect(
      handleMessage(
        { type: MessageType.CHECK_URL, url: 'https://blocked.com' },
        { id: 'test-extension-id' },
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ blocked: false });
    });
  });

  it('responds with blocked true when the URL should be blocked', async () => {
    const sendResponse = vi.fn();

    handleMessage(
      { type: MessageType.CHECK_URL, url: 'https://blocked.com/page' },
      { id: 'test-extension-id' },
      sendResponse
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ blocked: true });
    });
  });

  it('responds with blocked false when the URL is allowed', async () => {
    const sendResponse = vi.fn();

    handleMessage(
      { type: MessageType.CHECK_URL, url: 'https://allowed.com' },
      { id: 'test-extension-id' },
      sendResponse
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ blocked: false });
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
