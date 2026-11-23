/**
 * Handler for the extension being installed
 */

import { openOptionsPage } from '../../shared/api/runtime';

/**
 * Open Settings after a new install, where the empty state says how to start. Without it nothing
 * happens after installing, and the toolbar icon isn't pinned, so Teichos seems to do nothing.
 *
 * Updates to Teichos or to the browser leave the user's tabs alone. An Incognito window runs its
 * own instance of Teichos, and Chrome sends it this event as well while one is open, so only the
 * regular instance opens the tab.
 */
export function handleInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason !== 'install' || chrome.extension.inIncognitoContext) {
    return;
  }

  openOptionsPage().catch((error: unknown) => {
    console.error('[Teichos] Error opening Settings after install:', error);
  });
}
