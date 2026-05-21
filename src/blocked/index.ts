/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  type GetBlockedPageInfoResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  await renderBlockedState();

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
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.GO_BACK_ACTIVE_TAB,
  })) as GoBackActiveTabResponse;

  if (!response.restored) {
    console.warn('[Teichos] No restorable tab target is available.');
  }
}

async function renderBlockedState(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.GET_BLOCKED_PAGE_INFO,
  })) as GetBlockedPageInfoResponse;

  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = response.targetUrl ?? 'Unknown URL';
  }

  const filterElement = getElementByIdOrNull('blocked-filter');
  if (filterElement) {
    filterElement.textContent = response.filterLabel ?? 'Matched filter';
  }

  const groupElement = getElementByIdOrNull('blocked-group');
  if (groupElement) {
    groupElement.textContent = response.groupLabel ?? 'Unknown group';
  }
}

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
