/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  STORAGE_KEY,
  type BlockedTabState,
  type ContinueActiveTabWarningResponse,
  type GetBlockedTabStateResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';

interface InterstitialState {
  readonly targetUrl: string;
  readonly warningMode: boolean;
}

function getFallbackState(): InterstitialState {
  const params = new URLSearchParams(window.location.search);
  return {
    targetUrl: params.get('url') ?? 'Unknown URL',
    warningMode: params.get('mode') === 'warning',
  };
}

async function getBlockedState(): Promise<InterstitialState> {
  const fallbackState = getFallbackState();

  try {
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.GET_BLOCKED_TAB_STATE,
    })) as GetBlockedTabStateResponse;

    if (isBlockedTabState(response.state)) {
      return {
        targetUrl: response.state.targetUrl,
        warningMode: response.state.blockType === 'warning',
      };
    }
  } catch (error: unknown) {
    console.warn('[Teichos] Failed to load blocked tab state:', error);
  }

  return fallbackState;
}

function isBlockedTabState(state: unknown): state is BlockedTabState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'targetUrl' in state &&
    typeof state.targetUrl === 'string' &&
    'blockType' in state &&
    (state.blockType === 'block' || state.blockType === 'warning')
  );
}

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  await refreshInterstitial();

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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!shouldRefreshOnStorageChange(changes, areaName)) {
      return;
    }

    void refreshInterstitial().catch((error: unknown) => {
      console.error('Failed to refresh blocked page state:', error);
    });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message.type !== MessageType.DATA_UPDATED) {
      return;
    }

    void refreshInterstitial().catch((error: unknown) => {
      console.error('Failed to refresh blocked page after data update:', error);
    });
  });
}

async function refreshInterstitial(): Promise<void> {
  renderInterstitial(await getBlockedState());
}

function shouldRefreshOnStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): boolean {
  if (areaName === 'sync' && STORAGE_KEY in changes) {
    return true;
  }

  if (areaName !== 'session') {
    return false;
  }

  return Object.keys(changes).some((key) => key.startsWith('blocked_tab_state_'));
}

async function handleContinue(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.CONTINUE_ACTIVE_TAB_WARNING,
  })) as ContinueActiveTabWarningResponse;

  if (!response.continued) {
    await refreshInterstitial();
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

function renderInterstitial(state: InterstitialState): void {
  const headingElement = getElementByIdOrNull('blocked-heading');
  const messageElement = getElementByIdOrNull('blocked-message');
  const continueButton = getElementByIdOrNull<HTMLButtonElement>('continue');
  const goBackButton = getElementByIdOrNull<HTMLButtonElement>('go-back');
  const iconElement = document.querySelector<HTMLElement>('.icon');

  if (headingElement) {
    headingElement.textContent = state.warningMode ? 'Warning' : 'Page Blocked';
  }

  if (messageElement) {
    messageElement.textContent = state.warningMode
      ? 'This page matches a Teichos warning filter. You can continue for this tab or go back.'
      : 'This page has been blocked by Teichos based on your filter settings.';
  }

  if (continueButton) {
    continueButton.hidden = !state.warningMode;
  }

  if (goBackButton) {
    goBackButton.classList.toggle('secondary', state.warningMode);
  }

  if (iconElement) {
    iconElement.textContent = state.warningMode ? '⚠️' : '🛡️';
  }

  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = state.targetUrl;
  }
}

// Set up options button
const openOptionsButton = getElementByIdOrNull('open-options');
openOptionsButton?.addEventListener('click', () => {
  openOptionsPage().catch((error: unknown) => {
    console.error('Failed to open options page:', error);
  });
});

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
