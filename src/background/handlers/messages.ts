/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { loadData } from '../../shared/api/storage';
import {
  type CheckUrlResponse,
  type ContinueActiveTabResponse,
  type GetBlockedPageStateResponse,
  type GetDataResponse,
  type GoBackActiveTabResponse,
  isCheckUrlMessage,
  isContinueActiveTabMessage,
  isGetBlockedPageStateMessage,
  isGetDataMessage,
  isGoBackActiveTabMessage,
} from '../../shared/types';
import { getTabController } from '../tabController';

/**
 * Handle incoming messages from other extension contexts
 * Returns true if response will be sent asynchronously
 */
export function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  if (!isInternalSender(sender)) {
    return false;
  }

  if (isGetDataMessage(message)) {
    respond(sendResponse, handleGetData, { success: false });
    return true; // Will respond asynchronously
  }

  if (isCheckUrlMessage(message)) {
    respond(sendResponse, () => handleCheckUrl(message.url), { blocked: false });
    return true; // Will respond asynchronously
  }

  if (isGoBackActiveTabMessage(message)) {
    respond(sendResponse, () => handleGoBackActiveTab(sender), { restored: false });
    return true;
  }

  if (isContinueActiveTabMessage(message)) {
    respond(sendResponse, () => handleContinueActiveTab(message.blockId, sender), {
      continued: false,
    });
    return true;
  }

  if (isGetBlockedPageStateMessage(message)) {
    respond(sendResponse, () => handleGetBlockedPageState(message.blockId, sender), {
      status: 'unavailable',
    });
    return true;
  }

  return false;
}

/**
 * Always answer an async message. A handler that throws would otherwise leave the sender waiting
 * on an open channel, so a storage or tab failure shows up as a stuck popup or blocked page
 * instead of a normal "not available" result.
 */
function respond<T>(
  sendResponse: (response: unknown) => void,
  handler: () => Promise<T>,
  fallback: T
): void {
  handler().then(sendResponse, (error: unknown) => {
    console.error('[Teichos] Failed to handle message:', error);
    sendResponse(fallback);
  });
}

async function handleGetData(): Promise<GetDataResponse> {
  return { success: true, data: await loadData() };
}

async function handleCheckUrl(url: string): Promise<CheckUrlResponse> {
  const decision = await getTabController().getUrlDecision(url);
  return { blocked: decision.action === 'block' };
}

async function handleGoBackActiveTab(
  sender: chrome.runtime.MessageSender
): Promise<GoBackActiveTabResponse> {
  const senderTabId = sender.tab?.id;
  const restored =
    typeof senderTabId === 'number'
      ? await getTabController().goBackFromTab(senderTabId)
      : await getTabController().goBackFromActiveTab();
  return { restored };
}

async function handleContinueActiveTab(
  blockId: string | undefined,
  sender: chrome.runtime.MessageSender
): Promise<ContinueActiveTabResponse> {
  const senderTabId = sender.tab?.id;
  const continued =
    typeof senderTabId === 'number'
      ? await getTabController().continueFromTab(senderTabId, sender.tab?.url, blockId)
      : blockId
        ? await getTabController().continueFromBlockedPage(blockId)
        : await getTabController().continueFromActiveTab();
  return { continued };
}

async function handleGetBlockedPageState(
  blockId: string | undefined,
  sender: chrome.runtime.MessageSender
): Promise<GetBlockedPageStateResponse> {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId === 'number') {
    return getTabController().getBlockedPageStateForTab(senderTabId, sender.tab?.url);
  }

  if (blockId) {
    return getTabController().getBlockedPageStateByBlockId(blockId);
  }

  return { status: 'unavailable' };
}

function isInternalSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id === chrome.runtime.id) {
    return true;
  }

  const extensionRoot = chrome.runtime.getURL('');
  if (sender.url?.startsWith(extensionRoot)) {
    return true;
  }

  const senderOrigin = (sender as { readonly origin?: string }).origin;
  return senderOrigin === new URL(extensionRoot).origin;
}
