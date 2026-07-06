/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { sendExtensionMessage } from '../../shared/api/messaging';
import { openOptionsPage } from '../../shared/api/runtime';
import { loadData } from '../../shared/api/storage';
import {
  MessageType,
  type BlockedPageState,
  type FilterMatchMode,
  type GetBlockedPageStateResponse,
} from '../../shared/types';
import { getElementByIdOrNull } from '../../shared/utils/dom';
import { formatGroupScheduleSummary } from '../../shared/utils/schedules';

interface BlockedPageViewModel {
  readonly targetUrl: string;
  readonly state?: BlockedPageState;
}

/** Once the user clicks "Learn more", keep the extras open across re-renders. */
let learnMoreClicked = false;

/**
 * Initialize blocked page
 */
async function init(): Promise<void> {
  const goBackButton = getElementByIdOrNull('go-back');
  goBackButton?.addEventListener('click', () => {
    void handleGoBack().catch((error: unknown) => {
      console.error('Failed to navigate back:', error);
    });
  });

  const continueButton = getElementByIdOrNull('continue');
  continueButton?.addEventListener('click', () => {
    void handleContinue().catch((error: unknown) => {
      console.error('Failed to continue past block:', error);
    });
  });

  const learnMoreButton = getElementByIdOrNull('learn-more');
  learnMoreButton?.addEventListener('click', () => {
    learnMoreClicked = true;
    setExtrasExpanded(true);
  });

  // Set up options button
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage().catch((error: unknown) => {
      console.error('Failed to open options page:', error);
    });
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'session') {
      return;
    }

    void renderPage();
  });

  await renderPage();
}

async function renderPage(): Promise<void> {
  const state = await getBlockedPageState();
  renderBlockedUrl(state);
  renderResponsibleFilter(state);
  renderActions(state);
  await renderExtrasExpansion();
}

/**
 * Details and action buttons stay collapsed behind the "Learn more" link unless the user has
 * expanded them or the global "expand details by default" setting is enabled.
 */
async function renderExtrasExpansion(): Promise<void> {
  if (learnMoreClicked) {
    setExtrasExpanded(true);
    return;
  }

  let expandByDefault = false;
  try {
    const data = await loadData();
    expandByDefault = data.expandBlockPageDetails === true;
  } catch (error: unknown) {
    console.warn('[Teichos] Failed to load block page display settings:', error);
  }

  setExtrasExpanded(expandByDefault);
}

function setExtrasExpanded(expanded: boolean): void {
  const extras = getElementByIdOrNull<HTMLElement>('block-extras');
  if (extras) {
    extras.hidden = !expanded;
  }

  const learnMoreButton = getElementByIdOrNull<HTMLButtonElement>('learn-more');
  if (learnMoreButton) {
    learnMoreButton.hidden = expanded;
    learnMoreButton.setAttribute('aria-expanded', String(expanded));
  }
}

async function getBlockedPageState(): Promise<BlockedPageViewModel> {
  if (isPreviewMode()) {
    return getSampleBlockedPageState();
  }

  try {
    const blockId = getBlockedPageBlockId();
    const response = await sendExtensionMessage(
      blockId
        ? { type: MessageType.GET_BLOCKED_PAGE_STATE, blockId }
        : { type: MessageType.GET_BLOCKED_PAGE_STATE }
    );

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

/**
 * Whether the page was opened as a preview via the `preview` query param rather than a real block.
 */
function isPreviewMode(): boolean {
  return new URLSearchParams(window.location.search).get('preview') !== null;
}

/**
 * Build a representative sample block so users can preview the page from the options screen
 * without needing to actually trigger a block.
 */
function getSampleBlockedPageState(): BlockedPageViewModel {
  const targetUrl = 'https://www.example.com/';
  return {
    targetUrl,
    state: {
      blockId: 'preview',
      tabId: -1,
      targetUrl,
      blockedBy: { filterId: 'preview-filter', groupId: 'preview-group' },
      blockedAt: 0,
      rulesVersion: 0,
      filter: {
        id: 'preview-filter',
        pattern: 'example.com',
        matchMode: 'contains',
        description: 'Example filter',
      },
      group: {
        id: 'preview-group',
        name: 'Example group',
        schedules: [],
        is24x7: true,
        enabled: true,
      },
      effectiveState: {
        filterEnabled: true,
        groupActive: true,
        snoozeActive: false,
      },
    },
  };
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
  const response = await sendExtensionMessage({
    type: MessageType.GO_BACK_ACTIVE_TAB,
  });

  if (!response.restored) {
    console.warn('[Teichos] No restorable tab target is available.');
  }
}

async function handleContinue(): Promise<void> {
  const blockId = getBlockedPageBlockId();
  const response = await sendExtensionMessage({
    type: MessageType.CONTINUE_ACTIVE_TAB,
    ...(blockId ? { blockId } : {}),
  });

  if (!response.continued) {
    console.warn('[Teichos] No bypass is available for this tab.');
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
  if (!detailSection) {
    return;
  }

  if (!state.state) {
    detailSection.hidden = true;
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

function renderActions(state: BlockedPageViewModel): void {
  const continueButton = getElementByIdOrNull<HTMLButtonElement>('continue');
  if (continueButton) {
    continueButton.hidden = !state.state;
  }
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
