/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  type ContinueActiveTabWarningResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';

function isWarningMode(): boolean {
  return new URLSearchParams(window.location.search).get('mode') === 'warning';
}

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  renderInterstitial();

  const goBackButton = getElementByIdOrNull('go-back');
  goBackButton?.addEventListener('click', () => {
    void handleGoBack().catch((error: unknown) => {
      console.error('Failed to navigate back:', error);
    });
  });

  const continueButton = getElementByIdOrNull('continue');
  continueButton?.addEventListener('click', () => {
    void handleContinue().catch((error: unknown) => {
      console.error('Failed to continue past warning:', error);
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

async function handleContinue(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.CONTINUE_ACTIVE_TAB_WARNING,
  })) as ContinueActiveTabWarningResponse;

  if (!response.continued) {
    console.warn('[Teichos] No bypassable warning is available for this tab.');
  }
}

async function handleGoBack(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.GO_BACK_ACTIVE_TAB,
  })) as GoBackActiveTabResponse;

  if (!response.restored) {
    console.warn('[Teichos] No restorable tab target is available.');
  }
}

function renderInterstitial(): void {
  const warningMode = isWarningMode();
  const headingElement = getElementByIdOrNull('blocked-heading');
  const messageElement = getElementByIdOrNull('blocked-message');
  const continueButton = getElementByIdOrNull<HTMLButtonElement>('continue');
  const goBackButton = getElementByIdOrNull<HTMLButtonElement>('go-back');
  const iconElement = document.querySelector<HTMLElement>('.icon');

  if (headingElement) {
    headingElement.textContent = warningMode ? 'Warning' : 'Page Blocked';
  }

  if (messageElement) {
    messageElement.textContent = warningMode
      ? 'This page matches a Teichos warning filter. You can continue for this tab or go back.'
      : 'This page has been blocked by Teichos based on your filter settings.';
  }

  if (continueButton) {
    continueButton.hidden = !warningMode;
  }

  if (goBackButton) {
    goBackButton.classList.toggle('secondary', warningMode);
  }

  if (iconElement) {
    iconElement.textContent = warningMode ? '⚠️' : '🛡️';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = urlParams.get('url') ?? 'Unknown URL';
  }
}

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
