/**
 * Handler for tab update events
 * Checks if navigated URL should be blocked
 */

import { loadData } from '../../shared/api';
import { shouldBlockUrl } from '../../shared/utils';
import { getExtensionUrl } from '../../shared/api/runtime';
import { updateTabUrl } from '../../shared/api/tabs';
import { PAGES } from '../../shared/constants';

/**
 * Handle tab URL updates - check if the URL should be blocked
 */
export async function handleTabUpdate(
  tabId: number,
  changeInfo: { status?: string | undefined },
  tab: chrome.tabs.Tab
): Promise<void> {
  // Only check when status is loading and we have a URL
  if (changeInfo.status !== 'loading' || !tab.url) {
    return;
  }

  await checkAndBlockUrl(tabId, tab.url);
}

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
  // Don't check extension pages
  if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) {
    return;
  }

  const data = await loadData();
  const blockingFilter = shouldBlockUrl(
    url,
    data.filters,
    data.groups,
    data.whitelist
  );

  if (blockingFilter) {
    const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(url)}`;
    await updateTabUrl(tabId, blockedUrl);
  }
}
