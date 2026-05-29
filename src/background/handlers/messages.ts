/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { loadData } from '../../shared/api/storage';
import {
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
    void handleGetData(sendResponse);
    return true; // Will respond asynchronously
  }

  if (isCheckUrlMessage(message)) {
    void handleCheckUrl(message.url, sendResponse);
    return true; // Will respond asynchronously
  }

  if (isGoBackActiveTabMessage(message)) {
    void handleGoBackActiveTab(sender, sendResponse);
    return true;
  }

  if (isContinueActiveTabMessage(message)) {
    void handleContinueActiveTab(message.blockId, sender, sendResponse);
    return true;
  }

  if (isGetBlockedPageStateMessage(message)) {
    void handleGetBlockedPageState(message.blockId, sender, sendResponse);
    return true;
  }

  return false;
}

async function handleGetData(sendResponse: (response: unknown) => void): Promise<void> {
  const data = await loadData();
  sendResponse({ success: true, data });
}

async function handleCheckUrl(
  url: string,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const decision = await getTabController().getUrlDecision(url);
  sendResponse({ blocked: decision.action === 'block' });
}

async function handleGoBackActiveTab(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  const restored =
    typeof senderTabId === 'number'
      ? await getTabController().goBackFromTab(senderTabId)
      : await getTabController().goBackFromActiveTab();
  sendResponse({ restored });
}

async function handleContinueActiveTab(
  blockId: string | undefined,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  const continued =
    typeof senderTabId === 'number'
      ? await getTabController().continueFromTab(senderTabId, sender.tab?.url, blockId)
      : blockId
        ? await getTabController().continueFromBlockedPage(blockId)
        : await getTabController().continueFromActiveTab();
  sendResponse({ continued });
}

async function handleGetBlockedPageState(
  blockId: string | undefined,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId === 'number') {
    sendResponse(await getTabController().getFreshBlockedPageState(senderTabId, sender.tab?.url));
    return;
  }

  if (blockId) {
    sendResponse(await getTabController().getBlockedPageStateByBlockId(blockId));
    return;
  }

  sendResponse({ status: 'unavailable' });
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
