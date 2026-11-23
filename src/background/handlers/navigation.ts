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
 * Judge a page the tab has committed to: a new document committing, or a same-document URL change
 * (pushState, replaceState, or a fragment). A commit is the first time the destination of a server
 * redirect is seen, and the only event for a page Chrome restores from history without a
 * before-navigate event, such as a block page whose block has since ended.
 */
export async function handleNavigationChange(details: NavigationChangeDetails): Promise<void> {
  // Only check main frame
  if (details.frameId !== 0) {
    return;
  }

  await getTabController().evaluateNavigation(details.tabId, details.url);
}

export interface NavigationErrorDetails extends NavigationChangeDetails {
  error: string;
}

/** The error of a request an extension's declarativeNetRequest rule refused. */
const REFUSED_BY_EXTENSION = 'net::ERR_BLOCKED_BY_CLIENT';

/**
 * A page Chrome refused before its request left the browser. It fails where it would have
 * committed, so this stands in for the commit: see `judgeRefusedNavigation`.
 */
export async function handleNavigationError(details: NavigationErrorDetails): Promise<void> {
  if (details.frameId !== 0 || details.error !== REFUSED_BY_EXTENSION) {
    return;
  }

  await getTabController().judgeRefusedNavigation(details.tabId, details.url);
}

/**
 * Judge a navigation as soon as it starts, to block it before the page loads. Only the URL first
 * requested is known here; a server redirect's destination appears when the navigation commits.
 */
export async function handleBeforeNavigate(details: NavigationChangeDetails): Promise<void> {
  if (details.frameId !== 0) {
    return;
  }

  await getTabController().evaluateNavigation(details.tabId, details.url, { beforeCommit: true });
}
