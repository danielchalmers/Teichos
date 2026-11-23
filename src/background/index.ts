/**
 * Background Service Worker Entry Point
 *
 * MV3 service worker constraints:
 * - Event-driven: terminates when idle
 * - No DOM access
 * - All listeners must be registered synchronously at the top level
 * - Use chrome.storage instead of localStorage
 */

import {
  handleBeforeNavigate,
  handleMessage,
  handleNavigationChange,
  handleNavigationError,
  type NavigationChangeDetails,
} from './handlers';
import { registerSnoozeHandlers } from './snooze';
import { getTabController } from './tabController';

export function registerBackground(): void {
  // Register all event listeners synchronously.
  // This is critical for MV3 service workers.
  const logFailures =
    <T extends NavigationChangeDetails>(handler: (details: T) => Promise<void>) =>
    (details: T): void => {
      handler(details).catch((error: unknown) => {
        console.error('[Teichos] Error handling navigation:', error);
      });
    };

  // Every main-frame navigation is judged when it starts and again once the tab commits to it.
  chrome.webNavigation.onBeforeNavigate.addListener(logFailures(handleBeforeNavigate));
  chrome.webNavigation.onCommitted.addListener(logFailures(handleNavigationChange));
  chrome.webNavigation.onHistoryStateUpdated.addListener(logFailures(handleNavigationChange));
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(logFailures(handleNavigationChange));
  // A page refused by an early-block rule never commits; it fails instead.
  chrome.webNavigation.onErrorOccurred.addListener(logFailures(handleNavigationError));

  chrome.runtime.onMessage.addListener(handleMessage);
  getTabController().register();
  registerSnoozeHandlers();
}
