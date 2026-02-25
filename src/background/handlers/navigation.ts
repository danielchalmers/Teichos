/**
 * Handler for navigation events
 * Checks if navigated URL should be blocked
 */

import {
  buildBlockingIndex,
  isInternalUrl,
  isSnoozeActive,
  shouldBlockUrlWithIndex,
} from '../../shared/utils';
import { getExtensionUrl } from '../../shared/api/runtime';
import { loadData } from '../../shared/api/storage';
import { updateTabUrl } from '../../shared/api/tabs';
import { getSessionSnooze, setLastAllowedUrl, setSessionSnooze } from '../../shared/api/session';
import { PAGES } from '../../shared/constants';
import { STORAGE_KEY } from '../../shared/types';

/**
 * Handle web navigation before navigate event
 * Only processes main frame navigations
 */
export async function handleBeforeNavigate(
  details: chrome.webNavigation.WebNavigationParentedCallbackDetails
): Promise<void> {
  // Only check main frame
  if (details.frameId !== 0) {
    return;
  }

  await checkAndBlockUrl(details.tabId, details.url);
}

/**
 * Check URL against filters and redirect to blocked page if needed
 */
async function checkAndBlockUrl(tabId: number, url: string): Promise<void> {
  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  if (url.startsWith(blockedPageUrl)) {
    await restoreBlockedNavigationIfSnoozed(tabId, url, blockedPageUrl);
    return;
  }

  // Don't check other internal pages
  if (isInternalUrl(url)) {
    return;
  }

  if (await isSnoozeBypassActive()) {
    await setLastAllowedUrl(tabId, url);
    return;
  }

  const data = await loadData();
  if (isSnoozeActive(data.snooze)) {
    await setSessionSnooze(data.snooze);
    await setLastAllowedUrl(tabId, url);
    return;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  const blockingFilter = shouldBlockUrlWithIndex(url, blockingIndex);

  if (blockingFilter) {
    const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(url)}`;
    await updateTabUrl(tabId, blockedUrl);
    return;
  }

  await setLastAllowedUrl(tabId, url);
}

async function restoreBlockedNavigationIfSnoozed(
  tabId: number,
  blockedPageNavigationUrl: string,
  blockedPageUrl: string
): Promise<void> {
  let blockedTargetUrl: string | null = null;
  try {
    blockedTargetUrl = new URL(blockedPageNavigationUrl).searchParams.get('url');
  } catch {
    return;
  }

  if (
    !blockedTargetUrl ||
    isInternalUrl(blockedTargetUrl) ||
    blockedTargetUrl.startsWith(blockedPageUrl)
  ) {
    return;
  }

  if (await isSnoozeBypassActive()) {
    await setLastAllowedUrl(tabId, blockedTargetUrl);
    await updateTabUrl(tabId, blockedTargetUrl);
    return;
  }

  const data = await loadData();
  if (!isSnoozeActive(data.snooze)) {
    return;
  }

  await setSessionSnooze(data.snooze);
  await setLastAllowedUrl(tabId, blockedTargetUrl);
  await updateTabUrl(tabId, blockedTargetUrl);
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
