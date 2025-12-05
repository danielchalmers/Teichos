/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import { getElementByIdOrNull } from '../shared/utils/dom';

/**
 * Initialize blocked page
 */
function init(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const blockedUrl = urlParams.get('url') ?? 'Unknown URL';

  // Display the blocked URL
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = blockedUrl;
  }

  // Set up go back button
  const goBackButton = getElementByIdOrNull('go-back');
  goBackButton?.addEventListener('click', () => {
    window.history.back();
  });

  // Set up options button
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage().catch((error: unknown) => {
      console.error('Failed to open options page:', error);
    });
  });
}

// Initialize on load
init();
