/**
 * Handler for extension messages
 * Processes messages from popup, options, and content scripts
 */

import {
  buildBlockingIndex,
  isSnoozeActive,
  shouldBlockUrlWithIndex,
} from '../../shared/utils';
import { getSessionSnooze, setSessionSnooze } from '../../shared/api/session';
import { loadData } from '../../shared/api/storage';
import { STORAGE_KEY } from '../../shared/types';
import {
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
  if (await isSnoozeBypassActive()) {
    sendResponse({ blocked: false });
    return;
  }

  const data = await loadData();
  if (isSnoozeActive(data.snooze)) {
    await setSessionSnooze(data.snooze);
    sendResponse({ blocked: false });
    return;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  const blocked = shouldBlockUrlWithIndex(url, blockingIndex);
  sendResponse({ blocked: blocked !== undefined });
}

function isRawSnoozeActive(
  snooze: { active?: unknown; until?: unknown } | undefined,
  now = Date.now()
): boolean {
  if (!snooze || snooze.active !== true) {
    return false;
  }

  if (typeof snooze.until !== 'number' || !Number.isFinite(snooze.until)) {
    return true;
  }

  return snooze.until > now;
}

async function isSnoozeBypassActive(): Promise<boolean> {
  const sessionSnooze = await getSessionSnooze();
  if (isSnoozeActive(sessionSnooze)) {
    return true;
  }

  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const rawData = result[STORAGE_KEY] as { snooze?: { active?: unknown; until?: unknown } } | undefined;
  return isRawSnoozeActive(rawData?.snooze);
}
