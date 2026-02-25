/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import {
  buildBlockingIndex,
  shouldBlockUrlWithIndex,
} from '../../shared/utils';
import { loadData } from '../../shared/api/storage';
import {
  isGetDataMessage,
  isCheckUrlMessage,
} from '../../shared/types';
import { isSnoozeBypassActive } from '../snoozeBypass';

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
  if (await isSnoozeBypassActive()) {
    sendResponse({ blocked: false });
    return;
  }

  const data = await loadData();
  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  const blocked = shouldBlockUrlWithIndex(url, blockingIndex);
  sendResponse({ blocked: blocked !== undefined });
}
