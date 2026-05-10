import { describe, expect, it } from 'vitest';

import {
  MessageType,
  isCheckUrlMessage,
  isCloseInfoPanelMessage,
  isDataUpdatedMessage,
  isGetDataMessage,
  isUrlBlockedMessage,
} from '../../../src/shared/types';

describe('shared/types/messages', () => {
  it('recognizes GET_DATA and CHECK_URL requests', () => {
    expect(isGetDataMessage({ type: MessageType.GET_DATA })).toBe(true);
    expect(isGetDataMessage({ type: MessageType.CHECK_URL })).toBe(false);
    expect(isCheckUrlMessage({ type: MessageType.CHECK_URL, url: 'https://example.com' })).toBe(
      true
    );
    expect(isCheckUrlMessage({ type: MessageType.CHECK_URL, url: 42 })).toBe(false);
  });

  it('recognizes broadcast messages', () => {
    expect(isDataUpdatedMessage({ type: MessageType.DATA_UPDATED, data: {} })).toBe(true);
    expect(
      isUrlBlockedMessage({ type: MessageType.URL_BLOCKED, url: 'https://blocked.com', filter: {} })
    ).toBe(true);
    expect(isCloseInfoPanelMessage({ type: MessageType.CLOSE_INFO_PANEL })).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isGetDataMessage(null)).toBe(false);
    expect(isCheckUrlMessage('CHECK_URL')).toBe(false);
    expect(isDataUpdatedMessage({ type: MessageType.DATA_UPDATED })).toBe(false);
    expect(isUrlBlockedMessage({ type: MessageType.URL_BLOCKED, url: 'https://blocked.com' })).toBe(
      false
    );
  });
});
