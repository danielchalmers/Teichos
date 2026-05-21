/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  type ContinueWarningActiveTabResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';

type InterstitialMode = 'block-page' | 'warning';

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  const mode = renderInterstitial();

  const goBackButton = getElementByIdOrNull('go-back');
  goBackButton?.addEventListener('click', () => {
    void handleGoBack().catch((error: unknown) => {
      console.error('Failed to navigate back:', error);
    });
  });

  const continueButton = getElementByIdOrNull('continue-warning');
  if (mode === 'warning') {
    continueButton?.removeAttribute('hidden');
    continueButton?.addEventListener('click', () => {
      void handleContinueWarning().catch((error: unknown) => {
        console.error('Failed to continue past warning:', error);
        setInterstitialStatus('Failed to continue to the page.');
      });
    });
  } else {
    continueButton?.setAttribute('hidden', '');
  }

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

async function handleContinueWarning(): Promise<void> {
  setInterstitialStatus('');

  const response = (await chrome.runtime.sendMessage({
    type: MessageType.CONTINUE_WARNING_ACTIVE_TAB,
  })) as ContinueWarningActiveTabResponse;

  if (!response.continued) {
    const message = response.error ?? 'Failed to continue to the page.';
    console.warn('[Teichos] Warning continue failed:', message);
    setInterstitialStatus(message);
  }
}

function renderInterstitial(): InterstitialMode {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') === 'warning' ? 'warning' : 'block-page';
  const titleElement = getElementByIdOrNull('interstitial-title');
  const copyElement = getElementByIdOrNull('interstitial-copy');
  const blockedUrlElement = getElementByIdOrNull('blocked-url');

  if (titleElement) {
    titleElement.textContent = mode === 'warning' ? 'Proceed with Caution' : 'Page Blocked';
  }

  if (copyElement) {
    copyElement.textContent =
      mode === 'warning'
        ? 'This page matches a Teichos warning filter. Continue if you still want to visit it.'
        : 'This page has been blocked by Teichos based on your filter settings.';
  }

  if (blockedUrlElement) {
    blockedUrlElement.textContent = urlParams.get('url') ?? 'Unknown URL';
  }

  return mode;
}

function setInterstitialStatus(message: string): void {
  const statusElement = getElementByIdOrNull('interstitial-status');
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
}

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
