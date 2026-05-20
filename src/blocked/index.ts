/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import { getLastAllowedUrl } from '../shared/api/session';
import { loadData } from '../shared/api/storage';
import { getActiveTab, updateTabUrl } from '../shared/api/tabs';
import { STORAGE_KEY } from '../shared/types';
import { getBlockedTargetUrl, shouldRestoreBlockedTarget } from '../shared/api/blockedTabs';
import { getElementByIdOrNull } from '../shared/utils/dom';

let blockedUrl: string | null = null;
let isRestoring = false;

/**
 * Initialize blocked page
 */
function init(): void {
  blockedUrl = getBlockedTargetUrl(window.location.href);

  // Display the blocked URL
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = blockedUrl ?? 'Unknown URL';
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) {
      return;
    }
    void restoreIfAllowed().catch((error: unknown) => {
      console.error('Failed to restore blocked page after storage change:', error);
    });
  });

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

  void restoreIfAllowed().catch((error: unknown) => {
    console.error('Failed to restore blocked page:', error);
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

async function restoreIfAllowed(): Promise<void> {
  if (!blockedUrl || isRestoring) {
    return;
  }

  const data = await loadData();
  if (!shouldRestoreBlockedTarget(blockedUrl, data) || window.location.href === blockedUrl) {
    return;
  }

  isRestoring = true;
  window.location.replace(blockedUrl);
}

// Initialize on load
init();
