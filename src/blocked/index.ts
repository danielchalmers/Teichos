/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  type BlockedPageRuleSummary,
  type GetBlockedPageStateResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';

interface BlockedPageState {
  readonly targetUrl: string;
  readonly details?: BlockedPageRuleSummary;
}

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  renderBlockedUrl(await getBlockedPageState());

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

async function getBlockedPageState(): Promise<BlockedPageState> {
  const fallbackState = getFallbackBlockedPageState();

  try {
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.GET_BLOCKED_PAGE_STATE,
    })) as GetBlockedPageStateResponse;

    if (!isBlockedPageStateResponse(response)) {
      return fallbackState;
    }

    if (response.status === 'blocked') {
      return { targetUrl: response.state.targetUrl, details: response.details };
    }

    if (response.status === 'allowed') {
      return { targetUrl: response.targetUrl };
    }
  } catch (error: unknown) {
    console.warn('[Teichos] Failed to load blocked tab state:', error);
  }

  return fallbackState;
}

function getFallbackBlockedPageState(): BlockedPageState {
  const urlParams = new URLSearchParams(window.location.search);
  return { targetUrl: urlParams.get('url') ?? 'Unknown URL' };
}

function isBlockedPageStateResponse(response: unknown): response is GetBlockedPageStateResponse {
  if (!response || typeof response !== 'object' || !('status' in response)) {
    return false;
  }

  if (response.status === 'unavailable') {
    return true;
  }

  if (response.status === 'allowed') {
    return 'targetUrl' in response && typeof response.targetUrl === 'string';
  }

  return (
    response.status === 'blocked' &&
    'state' in response &&
    'details' in response &&
    typeof response.state === 'object' &&
    response.state !== null &&
    typeof response.details === 'object' &&
    response.details !== null &&
    'targetUrl' in response.state &&
    typeof response.state.targetUrl === 'string' &&
    'filterName' in response.details &&
    typeof response.details.filterName === 'string' &&
    'filterPattern' in response.details &&
    typeof response.details.filterPattern === 'string' &&
    'groupName' in response.details &&
    typeof response.details.groupName === 'string' &&
    'groupSchedule' in response.details &&
    typeof response.details.groupSchedule === 'string'
  );
}

async function handleGoBack(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MessageType.GO_BACK_ACTIVE_TAB,
  })) as GoBackActiveTabResponse;

  if (!response.restored) {
    console.warn('[Teichos] No restorable tab target is available.');
  }
}

function renderBlockedUrl(state: BlockedPageState): void {
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = state.targetUrl;
  }

  const detailsSection = getElementByIdOrNull('block-details');
  const filterElement = getElementByIdOrNull('blocked-filter');
  const filterPatternRow = getElementByIdOrNull('blocked-pattern-row');
  const filterPatternElement = getElementByIdOrNull('blocked-pattern');
  const groupElement = getElementByIdOrNull('blocked-group');
  const scheduleElement = getElementByIdOrNull('blocked-schedule');

  if (
    !state.details ||
    !detailsSection ||
    !filterElement ||
    !filterPatternRow ||
    !filterPatternElement ||
    !groupElement ||
    !scheduleElement
  ) {
    detailsSection?.setAttribute('hidden', '');
    return;
  }

  filterElement.textContent = state.details.filterName;
  groupElement.textContent = state.details.groupName;
  scheduleElement.textContent = state.details.groupSchedule;

  const shouldShowFilterPattern = state.details.filterName !== state.details.filterPattern;
  filterPatternElement.textContent = state.details.filterPattern;
  filterPatternRow.toggleAttribute('hidden', !shouldShowFilterPattern);
  detailsSection.removeAttribute('hidden');
}

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
