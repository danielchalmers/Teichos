/**
 * Message type definitions for extension messaging
 * Uses discriminated unions for type-safe message handling
 */

import type { Filter, FilterGroup, StorageData, Whitelist } from './storage';

// Message types enum for discriminated union
export const MessageType = {
  GET_DATA: 'GET_DATA',
  DATA_UPDATED: 'DATA_UPDATED',
  CHECK_URL: 'CHECK_URL',
  URL_BLOCKED: 'URL_BLOCKED',
  CLOSE_INFO_PANEL: 'CLOSE_INFO_PANEL',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// Request messages (sent to background)
export interface GetDataMessage {
  readonly type: typeof MessageType.GET_DATA;
}

export interface CheckUrlMessage {
  readonly type: typeof MessageType.CHECK_URL;
  readonly url: string;
}

// Response messages
export interface GetDataResponse {
  readonly success: true;
  readonly data: StorageData;
}

export interface CheckUrlResponse {
  readonly blocked: boolean;
}

// Notification messages (broadcast)
export interface DataUpdatedMessage {
  readonly type: typeof MessageType.DATA_UPDATED;
  readonly data: StorageData;
}

export interface UrlBlockedMessage {
  readonly type: typeof MessageType.URL_BLOCKED;
  readonly url: string;
  readonly filter: Filter;
}

export interface CloseInfoPanelMessage {
  readonly type: typeof MessageType.CLOSE_INFO_PANEL;
}

// Discriminated union of all messages
export type ExtensionMessage =
  | GetDataMessage
  | CheckUrlMessage
  | DataUpdatedMessage
  | UrlBlockedMessage
  | CloseInfoPanelMessage;

// Response type mapping
export type MessageResponse<T extends ExtensionMessage> =
  T extends GetDataMessage
    ? GetDataResponse
    : T extends CheckUrlMessage
      ? CheckUrlResponse
      : void;

// Type guards for message validation
export function isGetDataMessage(msg: unknown): msg is GetDataMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.GET_DATA
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

export function isDataUpdatedMessage(msg: unknown): msg is DataUpdatedMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.DATA_UPDATED &&
    'data' in msg
  );
}

export function isUrlBlockedMessage(msg: unknown): msg is UrlBlockedMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === MessageType.URL_BLOCKED &&
    'url' in msg &&
    'filter' in msg
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
