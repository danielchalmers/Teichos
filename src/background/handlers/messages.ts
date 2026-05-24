/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { loadData } from '../../shared/api/storage';
import {
  isCheckUrlMessage,
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
  // Validate sender is from our extension. Extension pages may provide a URL
  // without an id, depending on the runtime context.
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
    void handleGoBackActiveTab(sendResponse);
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

async function handleGoBackActiveTab(sendResponse: (response: unknown) => void): Promise<void> {
  sendResponse({ restored: await getTabController().goBackFromActiveTab() });
}

async function handleGetBlockedPageState(
  blockId: string | undefined,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== 'number') {
    sendResponse(await getTabController().getBlockedPageStateByBlockId(blockId));
    return;
  }

  sendResponse(await getTabController().getFreshBlockedPageState(senderTabId, sender.tab?.url));
}

function isInternalSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id === chrome.runtime.id) {
    return true;
  }

  if (!sender.url) {
    return false;
  }

  return sender.url.startsWith(chrome.runtime.getURL(''));
}
