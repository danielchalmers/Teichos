/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { openOptionsPage } from '../shared/api/runtime';
import {
  MessageType,
  type BlockedPageState,
  type FilterMatchMode,
  type GetBlockedPageStateResponse,
  type GoBackActiveTabResponse,
} from '../shared/types';
import { getElementByIdOrNull } from '../shared/utils/dom';
import { formatGroupScheduleSummary } from '../shared/utils/schedules';

interface BlockedPageViewModel {
  readonly targetUrl: string;
  readonly state?: BlockedPageState;
}

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  const state = await getBlockedPageState();
  renderBlockedUrl(state);
  renderResponsibleFilter(state);

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

async function getBlockedPageState(): Promise<BlockedPageViewModel> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.GET_BLOCKED_PAGE_STATE,
      blockId: getBlockedPageBlockId(),
    })) as GetBlockedPageStateResponse;

    if (!isBlockedPageStateResponse(response)) {
      return getUnavailableBlockedPageState();
    }

    if (response.status === 'blocked') {
      return {
        targetUrl: response.state.targetUrl,
        state: response.state,
      };
    }

    if (response.status === 'allowed') {
      return { targetUrl: response.targetUrl };
    }
  } catch (error: unknown) {
    console.warn('[Teichos] Failed to load blocked tab state:', error);
  }

  return getUnavailableBlockedPageState();
}

function getBlockedPageBlockId(): string | undefined {
  const blockId = new URLSearchParams(window.location.search).get('blockId');
  if (blockId === null) {
    return undefined;
  }

  const trimmedBlockId = blockId.trim();
  if (trimmedBlockId.length === 0) {
    return undefined;
  }

  return trimmedBlockId;
}

function getUnavailableBlockedPageState(): BlockedPageViewModel {
  return { targetUrl: 'Block details unavailable' };
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
    typeof response.state === 'object' &&
    response.state !== null &&
    'targetUrl' in response.state &&
    typeof response.state.targetUrl === 'string' &&
    'filter' in response.state &&
    typeof response.state.filter === 'object' &&
    response.state.filter !== null &&
    'pattern' in response.state.filter &&
    typeof response.state.filter.pattern === 'string' &&
    'matchMode' in response.state.filter &&
    isFilterMatchMode(response.state.filter.matchMode)
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

function renderBlockedUrl(state: BlockedPageViewModel): void {
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = state.targetUrl;
  }
}

function renderResponsibleFilter(state: BlockedPageViewModel): void {
  const detailSection = getElementByIdOrNull<HTMLElement>('responsible-filter');
  if (!detailSection || !state.state) {
    return;
  }

  setText('responsible-filter-name', getFilterDisplayName(state.state));
  setText('responsible-filter-pattern', state.state.filter.pattern);
  setText('responsible-filter-match', formatMatchMode(state.state.filter.matchMode));
  setText('responsible-filter-group', state.state.group?.name ?? 'Unknown group');
  setText(
    'responsible-filter-schedule',
    state.state.group ? formatGroupScheduleSummary(state.state.group) : 'Unavailable'
  );

  detailSection.hidden = false;
}

function setText(elementId: string, value: string): void {
  const element = getElementByIdOrNull(elementId);
  if (element) {
    element.textContent = value;
  }
}

function getFilterDisplayName(state: BlockedPageState): string {
  const name = state.filter.description?.trim();
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }

  return state.filter.pattern;
}

function formatMatchMode(matchMode: FilterMatchMode): string {
  if (matchMode === 'regex') {
    return 'Regular expression';
  }

  if (matchMode === 'exact') {
    return 'Exact URL';
  }

  return 'Contains text';
}

function isFilterMatchMode(value: unknown): value is FilterMatchMode {
  return value === 'contains' || value === 'exact' || value === 'regex';
}

// Initialize on load
void init().catch((error: unknown) => {
  console.error('Failed to initialize blocked page:', error);
});
