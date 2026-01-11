/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import { shouldBlockUrlWithIndex } from '../../shared/utils';
import {
  isGetDataMessage,
  isCheckUrlMessage,
} from '../../shared/types';
import { getStorageSnapshot } from '../storageCache';

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
  const { data } = await getStorageSnapshot();
  sendResponse({ success: true, data });
}

async function handleCheckUrl(
  url: string,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const { blockingIndex } = await getStorageSnapshot();
  const blocked = shouldBlockUrlWithIndex(url, blockingIndex);
  sendResponse({ blocked: blocked !== undefined });
}
