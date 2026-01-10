/**
 * Handler for navigation events
 * Checks if navigated URL should be blocked
 */

import { isInternalUrl, shouldBlockUrl } from '../../shared/utils';
import { getExtensionUrl } from '../../shared/api/runtime';
import { updateTabUrl } from '../../shared/api/tabs';
import { setLastAllowedUrl } from '../../shared/api/session';
import { PAGES } from '../../shared/constants';
import { getStorageSnapshot } from '../storageCache';

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
  // Don't check internal pages
  if (isInternalUrl(url)) {
    return;
  }

  const { data, whitelistByGroup } = await getStorageSnapshot();
  const blockingFilter = shouldBlockUrl(
    url,
    data.filters,
    data.groups,
    data.whitelist,
    whitelistByGroup
  );

  if (blockingFilter) {
    const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(url)}`;
    await updateTabUrl(tabId, blockedUrl);
    return;
  }

  await setLastAllowedUrl(tabId, url);
}
