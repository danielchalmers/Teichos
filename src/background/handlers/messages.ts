/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { loadData } from '../../shared/api';
import { shouldBlockUrl } from '../../shared/utils';
import {
  type ExtensionMessage,
  type MessageResponse,
  isGetDataMessage,
  isCheckUrlMessage,
} from '../../shared/types';

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
    handleGetData(sendResponse);
    return true; // Will respond asynchronously
  }

  if (isCheckUrlMessage(message)) {
    handleCheckUrl(message.url, sendResponse);
    return true; // Will respond asynchronously
  }

  return false;
}

async function handleGetData(
  sendResponse: (response: unknown) => void
): Promise<void> {
  const data = await loadData();
  sendResponse({ success: true, data });
}

async function handleCheckUrl(
  url: string,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const data = await loadData();
  const blocked = shouldBlockUrl(url, data.filters, data.groups, data.whitelist);
  sendResponse({ blocked: blocked !== undefined });
}
