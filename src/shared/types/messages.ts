/**
 * Message type definitions for extension messaging
 * Uses discriminated unions for type-safe message handling
 */

import type { BlockedPageState, StorageData } from './storage';

export const MessageType = {
  GET_DATA: 'GET_DATA',
  CHECK_URL: 'CHECK_URL',
  GET_BLOCKED_PAGE_STATE: 'GET_BLOCKED_PAGE_STATE',
  GO_BACK_ACTIVE_TAB: 'GO_BACK_ACTIVE_TAB',
  CONTINUE_ACTIVE_TAB: 'CONTINUE_ACTIVE_TAB',
  CLOSE_INFO_PANEL: 'CLOSE_INFO_PANEL',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export interface GetDataMessage {
  readonly type: typeof MessageType.GET_DATA;
}

export interface CheckUrlMessage {
  readonly type: typeof MessageType.CHECK_URL;
  readonly url: string;
}

export interface GoBackActiveTabMessage {
  readonly type: typeof MessageType.GO_BACK_ACTIVE_TAB;
  readonly blockId?: string;
}

export interface ContinueActiveTabMessage {
  readonly type: typeof MessageType.CONTINUE_ACTIVE_TAB;
  readonly blockId?: string;
}

export interface GetBlockedPageStateMessage {
  readonly type: typeof MessageType.GET_BLOCKED_PAGE_STATE;
  readonly blockId?: string;
}

export interface GetDataResponse {
  readonly success: true;
  readonly data: StorageData;
}

export interface CheckUrlResponse {
  readonly blocked: boolean;
}

export interface GoBackActiveTabResponse {
  readonly restored: boolean;
}

export interface ContinueActiveTabResponse {
  readonly continued: boolean;
}

export type GetBlockedPageStateResponse =
  | {
      readonly status: 'blocked';
      readonly state: BlockedPageState;
    }
  | {
      readonly status: 'allowed';
      readonly targetUrl: string;
    }
  | {
      readonly status: 'unavailable';
    };

export interface CloseInfoPanelMessage {
  readonly type: typeof MessageType.CLOSE_INFO_PANEL;
}

export type ExtensionMessage =
  | GetDataMessage
  | CheckUrlMessage
  | GoBackActiveTabMessage
  | ContinueActiveTabMessage
  | GetBlockedPageStateMessage
  | CloseInfoPanelMessage;

export type MessageResponse<T extends ExtensionMessage> = T extends GetDataMessage
  ? GetDataResponse
  : T extends CheckUrlMessage
    ? CheckUrlResponse
    : T extends GoBackActiveTabMessage
      ? GoBackActiveTabResponse
      : T extends ContinueActiveTabMessage
        ? ContinueActiveTabResponse
        : T extends GetBlockedPageStateMessage
          ? GetBlockedPageStateResponse
          : undefined;

export function isGetDataMessage(msg: unknown): msg is GetDataMessage {
  return (
    typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === MessageType.GET_DATA
  );
}

export function isCheckUrlMessage(msg: unknown): msg is CheckUrlMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.CHECK_URL &&
    'url' in msg &&
    typeof msg.url === 'string'
  );
}

export function isGoBackActiveTabMessage(msg: unknown): msg is GoBackActiveTabMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.GO_BACK_ACTIVE_TAB &&
    (!('blockId' in msg) || typeof msg.blockId === 'string')
  );
}

export function isContinueActiveTabMessage(msg: unknown): msg is ContinueActiveTabMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.CONTINUE_ACTIVE_TAB &&
    (!('blockId' in msg) || typeof msg.blockId === 'string')
  );
}

export function isGetBlockedPageStateMessage(msg: unknown): msg is GetBlockedPageStateMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.GET_BLOCKED_PAGE_STATE &&
    (!('blockId' in msg) || typeof msg.blockId === 'string')
  );
}

export function isCloseInfoPanelMessage(msg: unknown): msg is CloseInfoPanelMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.CLOSE_INFO_PANEL
  );
}
