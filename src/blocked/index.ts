/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import { getLastAllowedUrl } from '../shared/api/session';
import { getActiveTab, updateTabUrl } from '../shared/api/tabs';
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
    void handleGoBack().catch((error: unknown) => {
      console.error('Failed to navigate back:', error);
    });
  });

  // Set up options button
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage().catch((error: unknown) => {
      console.error('Failed to open options page:', error);
    });
  });
}

async function handleGoBack(): Promise<void> {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    window.history.back();
    return;
  }

  const lastAllowedUrl = await getLastAllowedUrl(activeTab.id);
  if (lastAllowedUrl) {
    await updateTabUrl(activeTab.id, lastAllowedUrl);
    return;
  }

  window.history.back();
}

// Initialize on load
init();
