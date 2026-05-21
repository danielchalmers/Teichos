/**
 * Handler for navigation events
 * Checks if navigated URL should be blocked
 */

import { getTabController } from '../tabController';

export interface NavigationChangeDetails {
  frameId: number;
  tabId: number;
  url: string;
}

/**
 * Handle web navigation event
 * Only processes main frame navigations
 */
export async function handleNavigationChange(details: NavigationChangeDetails): Promise<void> {
  // Only check main frame
  if (details.frameId !== 0) {
    return;
  }

  await getTabController().evaluateNavigation(details.tabId, details.url);
}

export async function handleBeforeNavigate(
  details: chrome.webNavigation.WebNavigationBaseCallbackDetails
): Promise<void> {
  await handleNavigationChange(details);
}
