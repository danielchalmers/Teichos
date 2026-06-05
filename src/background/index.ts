/**
 * Background Service Worker Entry Point
 *
 * MV3 service worker constraints:
 * - Event-driven: terminates when idle
 * - No DOM access
 * - All listeners must be registered synchronously at the top level
 * - Use chrome.storage instead of localStorage
 */

import { handleMessage, handleNavigationChange, type NavigationChangeDetails } from './handlers';
import { registerSnoozeHandlers } from './snooze';
import { getTabController } from './tabController';

export function registerBackground(): void {
  // Register all event listeners synchronously.
  // This is critical for MV3 service workers.
  const handleNavigationEvent = (details: NavigationChangeDetails): void => {
    handleNavigationChange(details).catch((error: unknown) => {
      console.error('[Teichos] Error handling navigation:', error);
    });
  };

  chrome.webNavigation.onBeforeNavigate.addListener(handleNavigationEvent);
  chrome.webNavigation.onHistoryStateUpdated.addListener(handleNavigationEvent);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(handleNavigationEvent);

  chrome.runtime.onMessage.addListener(handleMessage);
  getTabController().register();
  registerSnoozeHandlers();
}
