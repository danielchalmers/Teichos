/**
 * Handler for navigation events
 * Checks if navigated URL should be blocked
 */

import { getTabController } from '../tabController';

/**
 * Handle web navigation before navigate event
 * Only processes main frame navigations
 */
export async function handleBeforeNavigate(
  details: chrome.webNavigation.WebNavigationBaseCallbackDetails
): Promise<void> {
  // Only check main frame
  if (details.frameId !== 0) {
    return;
  }

  await getTabController().evaluateNavigation(details.tabId, details.url);
}
