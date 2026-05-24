/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { loadData } from '../../shared/api/storage';
import {
  isCheckUrlMessage,
  isContinueActiveTabWarningMessage,
  isGetBlockedTabStateMessage,
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
  // Validate sender is from our extension
  if (sender.id !== chrome.runtime.id) {
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

  if (isGetBlockedTabStateMessage(message)) {
    void handleGetBlockedTabState(sender, sendResponse);
    return true;
  }

  if (isContinueActiveTabWarningMessage(message)) {
    void handleContinueActiveTabWarning(sender, sendResponse);
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
  if (typeof senderTabId === 'number') {
    sendResponse({ restored: await getTabController().goBackFromTab(senderTabId) });
    return;
  }

  sendResponse({ restored: await getTabController().goBackFromActiveTab() });
}

async function handleGetBlockedTabState(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== 'number') {
    sendResponse({});
    return;
  }

  sendResponse({
    state: await getTabController().getBlockedStateFromTab(senderTabId, sender.tab?.url),
  });
}

async function handleContinueActiveTabWarning(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId === 'number') {
    sendResponse({
      continued: await getTabController().continueWarningFromTab(senderTabId, sender.tab?.url),
    });
    return;
  }

  sendResponse({ continued: await getTabController().continueWarningFromActiveTab() });
}
