/**
 * Blocked Page Entry Point
 * Displays information about the blocked URL and provides navigation options
 */

import { sendExtensionMessage } from '../../shared/api/messaging';
import { openOptionsPage } from '../../shared/api/runtime';
import { loadData } from '../../shared/api/storage';
import { removeTabs, updateTab } from '../../shared/api/tabs';
import {
  MessageType,
  type BlockedPageState,
  type FilterMatchMode,
  type GetBlockedPageStateResponse,
} from '../../shared/types';
import { getElementByIdOrNull } from '../../shared/utils/dom';
import {
  formatGroupScheduleSummary,
  formatScheduleSummary,
  formatUntil,
} from '../../shared/utils/schedules';

interface BlockedPageViewModel {
  readonly targetUrl: string;
  readonly state?: BlockedPageState;
}

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
    setExtrasExpanded(true);
    // The button hides itself, so move focus to what it revealed rather than losing it.
    getElementByIdOrNull('block-extras')?.focus();
  });

  // Set up options button
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage().catch((error: unknown) => {
      console.error('Failed to open options page:', error);
    });
  });

  await renderPage();
}

/**
 * The page renders once from the snapshot captured at the time of the block and never reacts to
 * later settings changes; if the block ends, the background redirects this tab to the target.
 */
async function renderPage(): Promise<void> {
  const state = await getBlockedPageState();
  renderPreviewNote();
  renderBlockedUrl(state);
  renderResponsibleFilter(state);
  renderActions(state);
  await renderExtrasExpansion();
}

/**
 * Details and action buttons stay collapsed behind the "Learn more" link unless the global
 * "expand details by default" setting is enabled.
 */
async function renderExtrasExpansion(): Promise<void> {
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
  // A preview has no page to return to, so close it and return to the tab that opened it.
  if (isPreviewMode()) {
    await closePreview();
    return;
  }

  const response = await sendExtensionMessage({
    type: MessageType.GO_BACK_ACTIVE_TAB,
  });

  if (!response.restored) {
    console.warn('[Teichos] No restorable tab target is available.');
  }
}

async function closePreview(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (typeof tab?.id === 'number') {
    // Chrome may otherwise activate a neighbouring tab instead of Settings.
    if (typeof tab.openerTabId === 'number') {
      // Settings may have been closed since; closing the preview still works without it.
      await updateTab(tab.openerTabId, { active: true }).catch(() => undefined);
    }
    await removeTabs([tab.id]);
    return;
  }

  window.close();
}

async function handleContinue(): Promise<void> {
  // The sample block has nothing to bypass. The button is disabled there; this guards stray calls.
  if (isPreviewMode()) {
    return;
  }

  const blockId = getBlockedPageBlockId();
  const response = await sendExtensionMessage({
    type: MessageType.CONTINUE_ACTIVE_TAB,
    ...(blockId ? { blockId } : {}),
  });

  if (!response.continued) {
    console.warn('[Teichos] No bypass is available for this tab.');
  }
}

/**
 * The preview looks like a real block, so it says it uses sample data. The note sits outside the
 * collapsible details so it shows before Learn more is clicked.
 */
function renderPreviewNote(): void {
  const previewNote = getElementByIdOrNull<HTMLElement>('preview-note');
  if (previewNote) {
    previewNote.hidden = !isPreviewMode();
  }
}

function renderBlockedUrl(state: BlockedPageViewModel): void {
  const blockedUrlElement = getElementByIdOrNull('blocked-url');
  if (blockedUrlElement) {
    blockedUrlElement.textContent = state.targetUrl;
    // Without block state the slot holds a message rather than an address, so it is not set as code.
    blockedUrlElement.classList.toggle('is-unavailable', !state.state);
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
  renderSchedule(state.state);

  detailSection.hidden = false;
}

/**
 * The group's schedule, plus when the block ends if a temporary filter caused it, e.g.
 * "Temporary · until 3:45 PM". Temporary blocks usually sit in the 24/7 group, where "Always
 * active" alone would read as a permanent block.
 */
function renderSchedule(state: BlockedPageState): void {
  const scheduleElement = getElementByIdOrNull('responsible-filter-schedule');
  if (!scheduleElement) {
    return;
  }

  const { filter, group } = state;
  const expiresAt =
    typeof filter.expiresAt === 'number' && Number.isFinite(filter.expiresAt)
      ? filter.expiresAt
      : undefined;
  const summaries = getScheduleSummaries(group, expiresAt !== undefined);

  // Each part is its own box ending in its separator, so a long schedule wraps between parts
  // rather than inside a range like "09:00–17:00", and no wrapped line starts with a separator.
  const parts = summaries.map((summary, index) =>
    index < summaries.length - 1 ? `${summary};` : summary
  );
  if (expiresAt !== undefined) {
    parts.push(`${parts.pop() ?? ''} ·`, formatUntil(expiresAt));
  }

  scheduleElement.replaceChildren(
    ...parts.flatMap((part, index) => {
      const partElement = document.createElement('span');
      partElement.className = 'schedule-part';
      partElement.textContent = part;
      return index === 0 ? [partElement] : [' ', partElement];
    })
  );
}

/**
 * One summary per schedule, which joined with "; " is the text of formatGroupScheduleSummary. A
 * temporary filter in the 24/7 group, where quick blocks land, reads "Temporary" instead.
 */
function getScheduleSummaries(group: BlockedPageState['group'], isTemporary: boolean): string[] {
  if (!group || group.is24x7) {
    if (isTemporary) {
      return ['Temporary'];
    }

    return [group ? formatGroupScheduleSummary(group) : 'Unavailable'];
  }

  return group.schedules.length > 0
    ? group.schedules.map(formatScheduleSummary)
    : [formatGroupScheduleSummary(group)];
}

function renderActions(state: BlockedPageViewModel): void {
  const continueButton = getElementByIdOrNull<HTMLButtonElement>('continue');
  if (continueButton) {
    continueButton.hidden = !state.state;
    // The preview keeps the button so its layout matches a real block, but there is nothing to
    // continue to, so it is disabled; the preview note is its description.
    if (isPreviewMode()) {
      continueButton.disabled = true;
      continueButton.setAttribute('aria-describedby', 'preview-note');
    }
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
