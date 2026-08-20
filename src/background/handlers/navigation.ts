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

/**
 * A redirect changes the URL within a single navigation: onBeforeNavigate only ever reports the
 * URL the browser first requested, and the target it lands on appears only when the navigation
 * commits. Without this the destination of any shortener, SSO bounce, or apex-to-www hop is never
 * matched against the filters.
 *
 * Only redirected navigations are re-evaluated. Every other commit carries the same URL
 * onBeforeNavigate already handled, so evaluating those again would just repeat the work.
 */
export async function handleNavigationCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
): Promise<void> {
  const wasRedirected = details.transitionQualifiers.some(
    (qualifier) => qualifier === 'server_redirect' || qualifier === 'client_redirect'
  );
  if (!wasRedirected) {
    return;
  }

  await handleNavigationChange(details);
}
