/**
 * Options Page Entry Point
 * Manages filters, groups, and whitelist entries
 */

import {
  loadData,
  addFilter,
  updateFilter,
  deleteFilter,
  exportData,
  importData,
  updateData,
  purgeExpiredTemporaryFilters,
  SettingsSaveError,
  addGroup,
  updateGroup,
  deleteGroup,
  addWhitelist,
  updateWhitelist,
  deleteWhitelist,
  clearSnooze,
} from '../../shared/api/storage';
import type {
  Filter,
  FilterGroup,
  FilterMatchMode,
  StorageData,
  Whitelist,
  MutableTimeSchedule,
} from '../../shared/types';
import { getRegexValidationError } from '../../shared/filtering/patterns';
import {
  isGroupEnabled,
  isSnoozeActive,
  isTemporaryFilter,
  sortFiltersTemporaryFirst,
} from '../../shared/filtering/schedules';
import { DEFAULT_GROUP_ID, isCloseInfoPanelMessage, STORAGE_KEY } from '../../shared/types';
import {
  announceStatus,
  clearDialogError,
  cloneTemplate,
  getElementByIdOrNull,
  querySelector,
  showDialogError,
} from '../../shared/utils/dom';
import { generateId, isValidTimeString } from '../../shared/utils/helpers';
import {
  formatGroupScheduleSummary,
  formatScheduleSummary,
  formatSnoozeEnd,
  formatTemporaryFilterLabel,
} from '../../shared/utils/schedules';
import { getExtensionUrl } from '../../shared/api/runtime';
import { createTab } from '../../shared/api/tabs';
import { DAY_FULL_NAMES, DAY_NAMES, DEFAULT_SCHEDULE, PAGES } from '../../shared/constants';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal state
let currentEditingFilterId: string | null = null;
let currentEditingGroupId: string | null = null;
let currentEditingWhitelistId: string | null = null;
let currentFilterGroupId: string | null = null;
let currentWhitelistGroupId: string | null = null;
let temporarySchedules: MutableTimeSchedule[] = [];
let activeModal: HTMLElement | null = null;
let lastFocusedElement: HTMLElement | null = null;
let lastFocusedGroupId: string | null = null;
let setInfoPopoverOpen: ((isOpen: boolean) => void) | null = null;
let globalSettingsStatusTimer: number | null = null;
let timedRefreshTimer: number | null = null;

/**
 * Initialize options page
 */
async function init(): Promise<void> {
  setupEventListeners();
  setupStorageSync();
  populateInfoPanel();
  await renderGroups();
  openFilterFromQuery();
  openInfoFromQuery();
  document.documentElement.dataset['optionsReady'] = 'true';
}

/**
 * Set up all event listeners
 */
function setupEventListeners(): void {
  setInfoPopoverOpen = setupInfoPopover();

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }

    if (isCloseInfoPanelMessage(message)) {
      setInfoPopoverOpen?.(false);
    }
  });

  // Add buttons
  getElementByIdOrNull('add-group-btn')?.addEventListener('click', () => openGroupModal());
  getElementByIdOrNull('preview-block-btn')?.addEventListener('click', () => {
    void handlePreviewBlockPage();
  });
  getElementByIdOrNull('export-settings-btn')?.addEventListener('click', () => {
    void handleExportSettings();
  });
  getElementByIdOrNull('import-settings-btn')?.addEventListener('click', () => {
    getElementByIdOrNull<HTMLInputElement>('import-settings-input')?.click();
  });
  getElementByIdOrNull<HTMLInputElement>('import-settings-input')?.addEventListener(
    'change',
    (event) => {
      void handleImportSettings(event);
    }
  );
  getElementByIdOrNull<HTMLInputElement>('global-expand-details')?.addEventListener(
    'change',
    () => {
      void handleGlobalExpandDetailsChange();
    }
  );
  getElementByIdOrNull('snooze-notice-resume')?.addEventListener('click', () => {
    void handleResumeSnooze();
  });

  // Filter modal
  getElementByIdOrNull('close-filter-modal')?.addEventListener('click', closeFilterModal);
  getElementByIdOrNull('cancel-filter')?.addEventListener('click', closeFilterModal);
  closeOnBackdropClick('filter-modal', closeFilterModal);
  getElementByIdOrNull('filter-form')?.addEventListener('submit', handleFilterSubmit);
  clearDialogErrorOnEdit('filter-form', 'filter-error');
  setupDeleteConfirm('filter', describeFilterDelete, handleFilterDelete);
  setupMatchModeHint('filter');

  // Group modal
  getElementByIdOrNull('close-group-modal')?.addEventListener('click', closeGroupModal);
  getElementByIdOrNull('cancel-group')?.addEventListener('click', closeGroupModal);
  closeOnBackdropClick('group-modal', closeGroupModal);
  getElementByIdOrNull('group-form')?.addEventListener('submit', handleGroupSubmit);
  clearDialogErrorOnEdit('group-form', 'group-error');
  setupDeleteConfirm('group', describeGroupDelete, handleGroupDelete);
  getElementByIdOrNull('add-schedule-btn')?.addEventListener('click', addScheduleToModal);
  getElementByIdOrNull('group-24x7')?.addEventListener('change', (e: Event) => {
    const is24x7 = (e.target as HTMLInputElement).checked;
    const schedulesContainer = getElementByIdOrNull('schedules-container');
    if (schedulesContainer) {
      schedulesContainer.hidden = is24x7;
    }
  });

  // Whitelist modal
  getElementByIdOrNull('close-whitelist-modal')?.addEventListener('click', closeWhitelistModal);
  getElementByIdOrNull('cancel-whitelist')?.addEventListener('click', closeWhitelistModal);
  closeOnBackdropClick('whitelist-modal', closeWhitelistModal);
  getElementByIdOrNull('whitelist-form')?.addEventListener('submit', handleWhitelistSubmit);
  clearDialogErrorOnEdit('whitelist-form', 'whitelist-error');
  setupDeleteConfirm('whitelist', describeWhitelistDelete, handleWhitelistDelete);
  setupMatchModeHint('whitelist');

  // Event delegation for list actions
  const groupsList = getElementByIdOrNull('groups-list');
  groupsList?.addEventListener('click', handleGroupsListClick);
  groupsList?.addEventListener('change', handleGroupsListChange);
  getElementByIdOrNull('schedules-list')?.addEventListener('click', handleSchedulesListClick);
  getElementByIdOrNull('schedules-list')?.addEventListener('change', handleSchedulesListClick);

  document.addEventListener('keydown', handleGlobalKeydown);
}

/**
 * A click on the backdrop around a dialog closes it, like Cancel. The backdrop holds the dialog, so
 * a press that starts or ends inside the dialog (a text selection dragged out of a field, or a
 * press dragged back in) also clicks the backdrop; only a press that starts and ends on it counts.
 */
function closeOnBackdropClick(modalId: string, close: () => void): void {
  const modal = getElementByIdOrNull(modalId);
  if (!modal) return;

  let pressStartedOnBackdrop = false;
  let pressEndedOnBackdrop = false;
  modal.addEventListener('pointerdown', (event) => {
    pressStartedOnBackdrop = event.target === modal;
  });
  modal.addEventListener('pointerup', (event) => {
    pressEndedOnBackdrop = event.target === modal;
  });
  modal.addEventListener('click', (event) => {
    if (pressStartedOnBackdrop && pressEndedOnBackdrop && event.target === modal) {
      close();
    }
    pressStartedOnBackdrop = false;
    pressEndedOnBackdrop = false;
  });
}

/** An error describes the input it was raised for, so drop it once the user changes the form. */
function clearDialogErrorOnEdit(formId: string, errorId: string): void {
  const form = getElementByIdOrNull(formId);
  const clear = (): void => clearDialogError(errorId);
  form?.addEventListener('input', clear);
  form?.addEventListener('change', clear);
}

/** The dialogs that edit one stored item; ids follow `${kind}-modal`, `delete-${kind}`, etc. */
type ItemDialogKind = 'filter' | 'group' | 'whitelist';

/**
 * Deleting from a dialog takes two steps: the quiet Delete button swaps the dialog's actions for
 * a confirm strip that says what will be lost, and only the strip's filled Delete button deletes.
 */
function setupDeleteConfirm(
  kind: ItemDialogKind,
  describe: () => Promise<string | null>,
  onConfirm: () => Promise<void>
): void {
  const confirmStrip = getElementByIdOrNull(`${kind}-delete-confirm`);
  getElementByIdOrNull(`delete-${kind}`)?.addEventListener('click', () => {
    void showDeleteConfirm(kind, describe).catch((error: unknown) => {
      console.error(`Failed to prepare ${kind} delete:`, error);
    });
  });
  confirmStrip
    ?.querySelector('[data-action="cancel-delete"]')
    ?.addEventListener('click', () => hideDeleteConfirm(kind, true));
  confirmStrip?.querySelector('[data-action="confirm-delete"]')?.addEventListener('click', () => {
    void onConfirm();
  });
  // Editing a field means the user has moved on from deleting, so bring back Save and Cancel.
  getElementByIdOrNull(`${kind}-form`)?.addEventListener('input', () => {
    if (isDeleteConfirmOpen(kind)) hideDeleteConfirm(kind);
  });
}

/**
 * While the confirm strip asks Keep or Delete, the form's Save button is only hidden, and a hidden
 * submit button still takes Enter in a field, so the submit handlers check this first.
 */
function isDeleteConfirmOpen(kind: ItemDialogKind): boolean {
  return getElementByIdOrNull(`${kind}-delete-confirm`)?.hidden === false;
}

async function showDeleteConfirm(
  kind: ItemDialogKind,
  describe: () => Promise<string | null>
): Promise<void> {
  const prompt = await describe();
  const modal = getElementByIdOrNull(`${kind}-modal`);
  // The dialog may have closed, or moved on to another item, while the prompt loaded.
  if (prompt === null || activeModal !== modal) return;

  const actions = modal?.querySelector<HTMLElement>('[data-role="dialog-actions"]');
  const confirmStrip = getElementByIdOrNull(`${kind}-delete-confirm`);
  const promptElement = getElementByIdOrNull(`${kind}-delete-prompt`);
  if (!actions || !confirmStrip || !promptElement) return;

  promptElement.textContent = prompt;
  actions.hidden = true;
  confirmStrip.hidden = false;
  confirmStrip.querySelector<HTMLElement>('[data-action="cancel-delete"]')?.focus();
}

/** Put the dialog's normal actions back; `restoreFocus` returns focus to its Delete button. */
function hideDeleteConfirm(kind: ItemDialogKind, restoreFocus = false): void {
  const actions = getElementByIdOrNull(`${kind}-modal`)?.querySelector<HTMLElement>(
    '[data-role="dialog-actions"]'
  );
  const confirmStrip = getElementByIdOrNull(`${kind}-delete-confirm`);
  if (actions) actions.hidden = false;
  if (confirmStrip) confirmStrip.hidden = true;
  if (restoreFocus) {
    getElementByIdOrNull(`delete-${kind}`)?.focus();
  }
}

/** Name an item the way its row does: its description, else its pattern. */
function quoteItemName(item: { readonly description?: string; readonly pattern: string }): string {
  const description = item.description?.trim();
  return `“${description === undefined || description === '' ? item.pattern : description}”`;
}

async function describeFilterDelete(): Promise<string | null> {
  const filterId = currentEditingFilterId;
  if (!filterId) return null;
  const filter = (await loadData()).filters.find((entry) => entry.id === filterId);
  if (currentEditingFilterId !== filterId) return null;
  return `Delete ${filter ? quoteItemName(filter) : 'this filter'}? This can't be undone.`;
}

async function describeWhitelistDelete(): Promise<string | null> {
  const whitelistId = currentEditingWhitelistId;
  if (!whitelistId) return null;
  const entry = (await loadData()).whitelist.find((item) => item.id === whitelistId);
  if (currentEditingWhitelistId !== whitelistId) return null;
  return `Delete ${entry ? quoteItemName(entry) : 'this exception'}? This can't be undone.`;
}

/** A deleted group's filters and exceptions are kept, so the prompt says where they go. */
async function describeGroupDelete(): Promise<string | null> {
  const groupId = currentEditingGroupId;
  if (!groupId || groupId === DEFAULT_GROUP_ID) return null;
  const data = await loadData();
  if (currentEditingGroupId !== groupId) return null;

  const group = data.groups.find((entry) => entry.id === groupId);
  const subject = group ? `“${group.name}”` : 'this group';
  const contents = describeGroupContents(data, groupId);
  if (!contents) {
    return `Delete ${subject}? This can't be undone.`;
  }

  const verb = contents.count === 1 ? 'moves' : 'move';
  return `Delete ${subject}? Its ${contents.text} ${verb} to ${getDefaultGroupName(data)}.`;
}

/** What a group holds, e.g. "1 filter and 2 exceptions", or null when it is empty. */
function describeGroupContents(
  data: StorageData,
  groupId: string
): { text: string; count: number } | null {
  const filterCount = data.filters.filter((filter) => filter.groupId === groupId).length;
  const exceptionCount = data.whitelist.filter((entry) => entry.groupId === groupId).length;
  if (filterCount + exceptionCount === 0) return null;

  const text = [
    filterCount > 0 ? pluralize(filterCount, 'filter') : null,
    exceptionCount > 0 ? pluralize(exceptionCount, 'exception') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' and ');
  return { text, count: filterCount + exceptionCount };
}

/** The default group can be renamed by an import, so use its stored name. */
function getDefaultGroupName(data: StorageData): string {
  return data.groups.find((entry) => entry.id === DEFAULT_GROUP_ID)?.name ?? 'the default group';
}

const MATCH_MODE_HINTS: Record<FilterMatchMode, { filter: string; whitelist: string }> = {
  contains: {
    filter: 'Blocks any address containing this text, like reddit.com.',
    whitelist: 'Allows any address containing this text, like reddit.com.',
  },
  exact: {
    filter: 'Blocks only this exact address.',
    whitelist: 'Allows only this exact address.',
  },
  regex: {
    filter: 'Advanced: tested against the full address.',
    whitelist: 'Advanced: tested against the full address.',
  },
};

/** Explain the selected match mode under its select, which references the hint. */
function setupMatchModeHint(kind: 'filter' | 'whitelist'): void {
  getElementByIdOrNull(`${kind}-match-mode`)?.addEventListener('change', () => {
    updateMatchModeHint(kind);
  });
  updateMatchModeHint(kind);
}

function updateMatchModeHint(kind: 'filter' | 'whitelist'): void {
  const hint = getElementByIdOrNull(`${kind}-match-hint`);
  if (hint) {
    hint.textContent = MATCH_MODE_HINTS[getMatchModeSelectValue(`${kind}-match-mode`)][kind];
  }
}

function setupStorageSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes[STORAGE_KEY]) return;
    void renderGroups().catch((error: unknown) => {
      console.error('Failed to refresh groups:', error);
    });
  });
}

/**
 * Resume filtering from the snooze notice; the re-render hides the notice. A failure is shown in
 * the notice itself, next to the button that caused it, and announced.
 */
async function handleResumeSnooze(): Promise<void> {
  try {
    await clearSnooze();
    await renderGroups();
    announceStatus('Filtering resumed.');
  } catch (error) {
    console.error('Failed to resume filtering:', error);
    showDialogError('snooze-notice-error', 'Failed to resume filtering. Please try again.');
  }
}

function setupInfoPopover(): ((isOpen: boolean) => void) | null {
  const popover = document.querySelector<HTMLElement>('.info-popover');
  if (!popover) return null;

  const button = popover.querySelector<HTMLButtonElement>('.info-button');
  const panel = popover.querySelector<HTMLElement>('.info-panel');
  if (!button || !panel) return null;

  const setOpen = (isOpen: boolean, returnFocus = false): void => {
    popover.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) {
      panel.removeAttribute('inert');
    } else {
      panel.setAttribute('inert', '');
      if (returnFocus) {
        button.focus();
      }
    }
  };

  setOpen(popover.classList.contains('is-open'));

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!popover.classList.contains('is-open'));
  });

  document.addEventListener('click', (event) => {
    if (!popover.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover.classList.contains('is-open')) {
      const shouldReturnFocus = popover.contains(document.activeElement);
      setOpen(false, shouldReturnFocus);
    }
  });

  // The panel overlaps the controls below it, so close it once keyboard focus moves past it.
  // A null relatedTarget (window blur, click on blank space) is left to the click handler.
  popover.addEventListener('focusout', (event) => {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && !popover.contains(nextFocus)) {
      setOpen(false);
    }
  });

  return setOpen;
}

function openFilterFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  const filterId = params.get('editFilter');
  const modal = params.get('modal');
  let handled = false;

  if (filterId) {
    openFilterModal(filterId, undefined, getDeepLinkTrigger(filterId, DEFAULT_GROUP_ID));
    handled = true;
  } else if (modal === 'filter') {
    openFilterModal(undefined, undefined, getDeepLinkTrigger(null, DEFAULT_GROUP_ID));
    handled = true;
  } else if (modal === 'whitelist') {
    openWhitelistModal(undefined, undefined, getDeepLinkTrigger(null, DEFAULT_GROUP_ID));
    handled = true;
  } else if (modal === 'group') {
    openGroupModal(undefined, getDeepLinkTrigger(null, null));
    handled = true;
  }

  if (!handled) return;

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('editFilter');
  nextUrl.searchParams.delete('modal');
  history.replaceState({}, document.title, nextUrl.toString());
}

function openInfoFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('info')) return;

  setInfoPopoverOpen?.(true);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('info');
  history.replaceState({}, document.title, nextUrl.toString());
}

function populateInfoPanel(): void {
  const manifest = chrome.runtime.getManifest();
  const versionElement = getElementByIdOrNull('info-version');
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  const year = new Date().getFullYear();
  const copyrightElement = getElementByIdOrNull('info-copyright');
  if (copyrightElement) {
    copyrightElement.textContent = `© ${year} Daniel Chalmers`;
  }
}

/**
 * Show the result of the latest General action under the card. The live region is cleared and the
 * message written on the next tick, so screen readers announce it even when it repeats.
 */
function setGlobalSettingsStatus(message: string, isError = false): void {
  const status = clearGlobalSettingsStatus();
  if (!status) return;

  status.classList.toggle('is-error', isError);
  globalSettingsStatusTimer = window.setTimeout(() => {
    globalSettingsStatusTimer = null;
    status.textContent = message;
  }, 0);
}

/** Drop the previous action's result, which no longer describes the latest action. */
function clearGlobalSettingsStatus(): HTMLElement | null {
  const status = getElementByIdOrNull('global-settings-status');
  if (!status) return null;

  if (globalSettingsStatusTimer !== null) {
    window.clearTimeout(globalSettingsStatusTimer);
    globalSettingsStatusTimer = null;
  }
  status.textContent = '';
  status.classList.remove('is-error');
  return status;
}

function createExportFileName(now = new Date()): string {
  const dateStamp = now.toISOString().slice(0, 10);
  return `teichos-settings-${dateStamp}.json`;
}

function downloadSettingsFile(serialized: string): void {
  const blob = new Blob([serialized], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = createExportFileName();
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

async function handleExportSettings(): Promise<void> {
  try {
    const serialized = await exportData();
    downloadSettingsFile(serialized);
    setGlobalSettingsStatus('Settings exported successfully.');
  } catch (error) {
    console.error('Failed to export settings:', error);
    setGlobalSettingsStatus('Failed to export settings.', true);
  }
}

async function handleImportSettings(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!input || !file) {
    return;
  }

  try {
    const serialized = await file.text();
    await importData(serialized);
    await renderGroups();
    setGlobalSettingsStatus('Settings imported successfully.');
  } catch (error) {
    console.error('Failed to import settings:', error);
    const message = error instanceof Error ? error.message : 'Failed to import settings.';
    setGlobalSettingsStatus(message, true);
  } finally {
    input.value = '';
  }
}

/**
 * Open the block page in a new tab using representative sample data so users can preview how a
 * block looks without needing to actually trigger one.
 */
async function handlePreviewBlockPage(): Promise<void> {
  const url = new URL(getExtensionUrl(PAGES.BLOCKED));
  url.searchParams.set('preview', '1');

  try {
    // Opened next to Settings with it as the opener, so closing the preview comes back here.
    const settingsTab = await chrome.tabs.getCurrent();
    await createTab({
      url: url.toString(),
      active: true,
      ...(typeof settingsTab?.id === 'number'
        ? { openerTabId: settingsTab.id, index: settingsTab.index + 1 }
        : {}),
    });
  } catch (error) {
    console.error('Failed to open block page preview:', error);
    setGlobalSettingsStatus('Failed to open block page preview.', true);
  }
}

function renderGlobalSettings(data: StorageData): void {
  const expandDetailsCheckbox = getElementByIdOrNull<HTMLInputElement>('global-expand-details');
  if (expandDetailsCheckbox) {
    expandDetailsCheckbox.checked = data.expandBlockPageDetails === true;
  }
}

async function handleGlobalExpandDetailsChange(): Promise<void> {
  const expandBlockPageDetails =
    getElementByIdOrNull<HTMLInputElement>('global-expand-details')?.checked === true;

  try {
    await updateData((data) => ({ ...data, expandBlockPageDetails }));
    // The switch shows its own state, so the change is only announced; a visible line under the
    // card would read as part of Backup.
    clearGlobalSettingsStatus();
    announceStatus(
      expandBlockPageDetails
        ? 'Block page details will be shown.'
        : 'Block page details will be hidden.'
    );
  } catch (error) {
    console.error('Failed to update block page details preference:', error);
    setGlobalSettingsStatus(
      describeSaveError(error, 'Failed to update block page details preference.'),
      true
    );
    renderGlobalSettings(await loadData());
  }
}

// ============================================================================
// Accessibility Helpers
// ============================================================================

function setMainInert(isInert: boolean): void {
  const container = document.querySelector<HTMLElement>('.container');
  if (!container) return;

  if (isInert) {
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('inert', '');
  } else {
    container.removeAttribute('aria-hidden');
    container.removeAttribute('inert');
  }
}

/** Controls that can take focus right now; a hidden one (e.g. the idle confirm strip) cannot. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0
  );
}

function focusModal(modal: HTMLElement, preferredSelector?: string): void {
  if (preferredSelector) {
    const preferredElement = modal.querySelector<HTMLElement>(preferredSelector);
    if (preferredElement) {
      preferredElement.focus();
      return;
    }
  }

  const focusableElements = getFocusableElements(modal);
  if (focusableElements.length > 0) {
    focusableElements[0]?.focus();
    return;
  }

  const fallback = modal.querySelector<HTMLElement>('.modal-content');
  fallback?.focus();
}

/**
 * Ids come from storage or an imported file and can be any string, so every value is escaped
 * before it goes into the selector.
 */
function getFocusRestoreSelector(element: HTMLElement): string | null {
  const action = element.getAttribute('data-action');
  if (!action) return null;
  const actionSelector = `[data-action="${CSS.escape(action)}"]`;

  const filterId = element.getAttribute('data-filter-id');
  if (filterId) {
    return `${actionSelector}[data-filter-id="${CSS.escape(filterId)}"]`;
  }

  const whitelistId = element.getAttribute('data-whitelist-id');
  if (whitelistId) {
    return `${actionSelector}[data-whitelist-id="${CSS.escape(whitelistId)}"]`;
  }

  const groupId = element.getAttribute('data-group-id');
  if (groupId) {
    return `${actionSelector}[data-group-id="${CSS.escape(groupId)}"]`;
  }

  return actionSelector;
}

function getGroupIdFor(element: HTMLElement | null): string | null {
  return element?.closest<HTMLElement>('.group-item')?.dataset['groupId'] ?? null;
}

/**
 * Resolve where focus belongs once a re-render may have removed `element`: its re-rendered
 * counterpart, else its group's disclosure (the item was deleted), else the New Group button
 * (the group was deleted), so focus never falls back to the document body. A disabled control
 * (its group became read-only) cannot take focus either, so it falls through the same way.
 */
function resolveFocusTarget(element: HTMLElement, groupId: string | null): HTMLElement | null {
  if (element.isConnected && !element.matches(':disabled')) return element;

  const groupsList = getElementByIdOrNull('groups-list');
  const selector = getFocusRestoreSelector(element);
  const replacement = selector ? groupsList?.querySelector<HTMLElement>(selector) : null;
  if (replacement && !replacement.matches(':disabled')) return replacement;

  return getGroupFocusFallback(groupId);
}

/** The group's disclosure, else the New Group button; neither is ever disabled. */
function getGroupFocusFallback(groupId: string | null): HTMLElement | null {
  if (groupId) {
    const disclosure = getElementByIdOrNull('groups-list')?.querySelector<HTMLElement>(
      `.group-disclosure[data-group-id="${CSS.escape(groupId)}"]`
    );
    if (disclosure) return disclosure;
  }

  return getElementByIdOrNull('add-group-btn');
}

/**
 * A modal opened from a deep link has no control that opened it, so stand in the one a user would
 * have used: the filter's Edit button, else the target group's disclosure, else New Group.
 */
function getDeepLinkTrigger(filterId: string | null, groupId: string | null): HTMLElement | null {
  const editButton = filterId
    ? getElementByIdOrNull('groups-list')?.querySelector<HTMLElement>(
        `[data-action="edit-filter"][data-filter-id="${CSS.escape(filterId)}"]`
      )
    : null;
  return editButton ?? getGroupFocusFallback(groupId);
}

function trapFocus(event: KeyboardEvent, modal: HTMLElement): void {
  const focusableElements = getFocusableElements(modal);
  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement | null;

  if (!active || !modal.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Remember the control that opened the modal so focus can return to it. A modal opened from a
 * deep link has no such control (focus is on the body), so `fallbackTrigger` stands in for it.
 */
function activateModal(
  modal: HTMLElement,
  preferredSelector?: string,
  fallbackTrigger: HTMLElement | null = null
): void {
  const active = document.activeElement;
  lastFocusedElement =
    active instanceof HTMLElement && active !== document.body ? active : fallbackTrigger;
  lastFocusedGroupId = getGroupIdFor(lastFocusedElement);
  activeModal = modal;
  modal.setAttribute('aria-hidden', 'false');
  setMainInert(true);
  window.requestAnimationFrame(() => {
    focusModal(modal, preferredSelector);
  });
}

function deactivateModal(modal: HTMLElement): void {
  if (activeModal !== modal) return;
  modal.setAttribute('aria-hidden', 'true');
  setMainInert(false);
  activeModal = null;
  if (lastFocusedElement) {
    resolveFocusTarget(lastFocusedElement, lastFocusedGroupId)?.focus();
    lastFocusedElement = null;
    lastFocusedGroupId = null;
  }
}

// ============================================================================
// Rendering Functions
// ============================================================================

async function renderGroups(): Promise<void> {
  let data = await loadData();
  data = await purgeExpiredTemporaryFilters(data);
  renderGlobalSettings(data);
  const groupsList = getElementByIdOrNull('groups-list');
  if (!groupsList) return;

  const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const restoreFocus = focusTarget !== null && groupsList.contains(focusTarget);
  const focusGroupId = restoreFocus ? getGroupIdFor(focusTarget) : null;

  const hadGroups = groupsList.children.length > 0;
  const openGroupIds = new Set(
    Array.from(groupsList.querySelectorAll<HTMLElement>('.group-item.is-open'))
      .map((groupElement) => groupElement.dataset['groupId'])
      .filter((groupId): groupId is string => Boolean(groupId))
  );

  const filtersByGroup = new Map<string, Filter[]>();
  for (const filter of data.filters) {
    const groupFilters = filtersByGroup.get(filter.groupId);
    if (groupFilters) {
      groupFilters.push(filter);
    } else {
      filtersByGroup.set(filter.groupId, [filter]);
    }
  }

  const whitelistByGroup = new Map<string, Whitelist[]>();
  for (const entry of data.whitelist) {
    const groupEntries = whitelistByGroup.get(entry.groupId);
    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      whitelistByGroup.set(entry.groupId, [entry]);
    }
  }
  const fragment = document.createDocumentFragment();
  const snoozeActive = isSnoozeActive(data.snooze);
  for (const [index, group] of data.groups.entries()) {
    const filters = sortFiltersTemporaryFirst(filtersByGroup.get(group.id) ?? []);
    const whitelist = whitelistByGroup.get(group.id) ?? [];
    fragment.appendChild(renderGroup(group, index, filters, whitelist, snoozeActive));
  }

  groupsList.replaceChildren(fragment);
  renderSnoozeNotice(data, snoozeActive);
  scheduleTimedRefresh(data, snoozeActive);

  const groupElements = groupsList.querySelectorAll<HTMLElement>('.group-item');
  if (openGroupIds.size > 0) {
    groupElements.forEach((groupElement) => {
      const groupId = groupElement.dataset['groupId'];
      if (groupId && openGroupIds.has(groupId)) {
        setGroupOpen(groupElement, true);
      }
    });
  } else if (!hadGroups) {
    groupElements.forEach((groupElement) => {
      const group = data.groups.find((entry) => entry.id === groupElement.dataset['groupId']);
      setGroupOpen(groupElement, isGroupEnabled(group));
    });
  }

  if (restoreFocus) {
    resolveFocusTarget(focusTarget, focusGroupId)?.focus();
  }
}

/**
 * Show the snooze notice with its end as a clock time, which stays correct without ticking. When
 * the snooze ends, the notice hides; if its Resume button had focus, focus moves on to the first
 * group instead of falling back to the document body.
 */
function renderSnoozeNotice(data: StorageData, snoozeActive: boolean): void {
  const notice = getElementByIdOrNull('snooze-notice');
  const title = getElementByIdOrNull('snooze-notice-title');
  if (!notice || !title) return;

  if (snoozeActive) {
    title.textContent = `Filtering is snoozed ${formatSnoozeEnd(data.snooze)}.`;
  }

  const resumeHadFocus = notice.contains(document.activeElement);
  notice.hidden = !snoozeActive;
  if (!snoozeActive) {
    // A failed Resume no longer applies once the snooze is over, however it ended.
    clearDialogError('snooze-notice-error');
  }
  if (resumeHadFocus && !snoozeActive) {
    const firstGroupId =
      document.querySelector<HTMLElement>('#groups-list .group-item')?.dataset['groupId'] ?? null;
    getGroupFocusFallback(firstGroupId)?.focus();
  }
}

/** setTimeout fires immediately for delays past 2^31 - 1 ms, so long waits are re-checked. */
const MAX_REFRESH_DELAY_MS = 60 * 60_000;

/**
 * Keep time-based text current without a ticking re-render: re-render when the snooze or a
 * temporary filter ends (the background also clears an ended snooze, but on its own schedule),
 * and refresh the "45m left" labels in place each minute while any are shown.
 */
function scheduleTimedRefresh(data: StorageData, snoozeActive: boolean, now = Date.now()): void {
  if (timedRefreshTimer !== null) {
    window.clearTimeout(timedRefreshTimer);
    timedRefreshTimer = null;
  }

  const temporaryEnds = data.filters
    .filter(isTemporaryFilter)
    .map((filter) => filter.expiresAt)
    .filter((time) => time > now);
  const snoozeEnd =
    snoozeActive && typeof data.snooze.until === 'number' ? data.snooze.until : Infinity;
  const nextEnd = Math.min(snoozeEnd, ...temporaryEnds);
  if (nextEnd === Infinity) return;

  // Remaining time is shown in whole minutes, rounded up, so a label changes each time its
  // remaining time reaches a whole minute.
  const nextLabelChange = Math.min(
    ...temporaryEnds.map((end) => now + ((end - now) % 60_000 || 60_000))
  );
  const delay = Math.min(nextEnd, nextLabelChange) - now;

  timedRefreshTimer = window.setTimeout(
    () => {
      timedRefreshTimer = null;
      // The re-render below rebuilds the rows but not an open filter dialog's subtitle.
      refreshTemporaryLabels();
      if (Date.now() >= nextEnd) {
        void renderGroups().catch((error: unknown) => {
          console.error('Failed to refresh groups:', error);
        });
      } else {
        scheduleTimedRefresh(data, snoozeActive);
      }
    },
    Math.min(Math.max(delay, 0) + 50, MAX_REFRESH_DELAY_MS)
  );
}

/** Update every "Temporary · 45m left" label: the rows, and the filter dialog's subtitle. */
function refreshTemporaryLabels(): void {
  document.querySelectorAll<HTMLElement>('[data-role="filter-expiry"]').forEach((label) => {
    const expiresAt = Number(label.dataset['expiresAt']);
    if (Number.isFinite(expiresAt)) {
      label.textContent = formatTemporaryFilterLabel(expiresAt - Date.now());
    }
  });
}

/** A temporary filter's "Temporary · 45m left" label, which refreshTemporaryLabels keeps current. */
function createTemporaryLabel(tagName: 'div' | 'span', expiresAt: number): HTMLElement {
  const label = document.createElement(tagName);
  label.dataset['role'] = 'filter-expiry';
  label.dataset['expiresAt'] = String(expiresAt);
  label.textContent = formatTemporaryFilterLabel(expiresAt - Date.now());
  return label;
}

/**
 * Expand or collapse a group card. Collapsed content uses hidden="until-found" so find-in-page
 * can still reveal it, like the native disclosure it replaces.
 */
function setGroupOpen(groupElement: HTMLElement, isOpen: boolean): void {
  const disclosure = querySelector<HTMLButtonElement>('.group-disclosure', groupElement);
  const content = querySelector<HTMLElement>('[data-role="group-content"]', groupElement);

  groupElement.classList.toggle('is-open', isOpen);
  disclosure.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    content.removeAttribute('hidden');
  } else {
    content.setAttribute('hidden', 'until-found');
  }
}

function renderGroup(
  group: FilterGroup,
  index: number,
  filters: readonly Filter[],
  whitelist: readonly Whitelist[],
  snoozeActive: boolean
): HTMLElement {
  const isDefault = group.id === DEFAULT_GROUP_ID;
  const groupEnabled = isGroupEnabled(group);
  const filterSummary = pluralize(filters.length, 'filter');
  const exceptionSummary = pluralize(whitelist.length, 'exception', 'exceptions');

  // Group ids come from storage or an imported file and can hold spaces or quotes, which would
  // break the IDREFs below, so element ids use a safe token made unique by the render index.
  const idToken = `${index}-${group.id.replace(/[^\w-]/g, '_')}`;

  const groupElement = cloneTemplate<HTMLElement>('options-group-template');
  groupElement.dataset['groupId'] = group.id;
  groupElement.classList.toggle('group-disabled', !groupEnabled);

  querySelector<HTMLElement>('[data-role="group-title"]', groupElement).textContent = group.name;
  const meta = querySelector<HTMLElement>('[data-role="group-meta"]', groupElement);
  meta.replaceChildren(...renderGroupMeta(group, filterSummary, exceptionSummary));
  meta.id = `group-meta-${idToken}`;

  // The disclosure sits outside [data-role="group-actions"] so readonly groups can still expand.
  const disclosure = querySelector<HTMLButtonElement>('.group-disclosure', groupElement);
  const content = querySelector<HTMLElement>('[data-role="group-content"]', groupElement);
  content.id = `group-content-${idToken}`;
  disclosure.dataset['groupId'] = group.id;
  disclosure.setAttribute('aria-controls', content.id);
  disclosure.setAttribute('aria-describedby', meta.id);
  content.addEventListener('beforematch', () => {
    setGroupOpen(groupElement, true);
  });

  const groupToggle = querySelector<HTMLLabelElement>('[data-role="group-toggle"]', groupElement);
  const groupToggleInput = querySelector<HTMLInputElement>(
    'input[data-action="toggle-group"]',
    groupToggle
  );
  groupToggleInput.checked = groupEnabled;
  groupToggleInput.dataset['groupId'] = group.id;
  groupToggleInput.setAttribute('aria-label', `Toggle group ${group.name}`);

  // The switch stays the last control, so it lines up with every other switch on the page.
  const actions = querySelector<HTMLElement>('[data-role="group-actions"]', groupElement);
  if (!isDefault) {
    const editButton = cloneTemplate<HTMLButtonElement>('options-group-edit-button-template');
    editButton.dataset['groupId'] = group.id;
    setIconButtonLabel(editButton, `Edit group ${group.name}`);
    actions.prepend(editButton);
  }

  const filterList = querySelector<HTMLElement>('[data-role="filter-list"]', groupElement);
  const whitelistList = querySelector<HTMLElement>('[data-role="whitelist-list"]', groupElement);
  const addFilterButton = querySelector<HTMLButtonElement>(
    'button[data-action="add-filter"]',
    groupElement
  );
  const addWhitelistButton = querySelector<HTMLButtonElement>(
    'button[data-action="add-whitelist"]',
    groupElement
  );

  addFilterButton.dataset['groupId'] = group.id;
  addWhitelistButton.dataset['groupId'] = group.id;

  if (filters.length === 0) {
    filterList.appendChild(createEmptyState('No filters in this group.'));
  } else {
    const filterFragment = document.createDocumentFragment();
    for (const filter of filters) {
      filterFragment.appendChild(renderFilterItem(filter));
    }
    filterList.appendChild(filterFragment);
  }

  if (whitelist.length === 0) {
    whitelistList.appendChild(createEmptyState('No exceptions in this group.'));
  } else {
    const whitelistFragment = document.createDocumentFragment();
    for (const entry of whitelist) {
      whitelistFragment.appendChild(renderWhitelistItem(entry));
    }
    whitelistList.appendChild(whitelistFragment);
  }

  // A group that is off, or every group while snoozed, is read-only: its Edit button (name,
  // schedules, Delete) as well as its rows. The dimmed controls show it; the switch stays live.
  setGroupReadonlyState(groupElement, snoozeActive || !groupEnabled);

  return groupElement;
}

/** A no-break space keeps a " ·" separator on the part before it. */
const META_SEPARATOR = '\u00a0·';

/**
 * The group's meta line, e.g. "Mon–Fri 09:00–17:00; Sat 10:00–12:00 · 2 filters · 0 exceptions".
 * Each schedule is its own part, so a narrow line wraps between schedules rather than inside one,
 * and every part but the last ends with its separator, so a wrapped line never starts with one.
 */
function renderGroupMeta(
  group: FilterGroup,
  filterSummary: string,
  exceptionSummary: string
): (Node | string)[] {
  // The default group's name already says when it applies, so its meta line only counts.
  let scheduleParts: string[] = [];
  if (group.id !== DEFAULT_GROUP_ID) {
    scheduleParts =
      group.is24x7 || group.schedules.length === 0
        ? [formatGroupScheduleSummary(group)]
        : group.schedules.map(formatScheduleSummary);
  }

  const parts = [
    ...scheduleParts.map((text, index) => ({
      text,
      separator: index < scheduleParts.length - 1 ? ';' : META_SEPARATOR,
    })),
    { text: filterSummary, separator: META_SEPARATOR },
    { text: exceptionSummary, separator: '' },
  ];
  return parts.flatMap(({ text, separator }, index) => {
    const span = document.createElement('span');
    span.className = 'meta-part';
    span.textContent = `${text}${separator}`;
    return index === 0 ? [span] : [' ', span];
  });
}

/** Icon-only buttons show their accessible name as a tooltip too. */
function setIconButtonLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
}

/**
 * Apply readonly behavior for groups that are snoozed or explicitly disabled.
 * This disables interactive child controls while leaving the header disclosure and
 * group enabled toggle available so users can still inspect or re-enable the group.
 */
function setGroupReadonlyState(groupElement: HTMLElement, readonly: boolean): void {
  const groupContent = querySelector<HTMLElement>('.group-content', groupElement);
  groupContent.classList.toggle('is-readonly', readonly);

  groupElement
    .querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(
      '[data-role="group-actions"] button, .group-content button, .group-content input, .group-content select, .group-content textarea'
    )
    .forEach((element) => {
      element.disabled = readonly;
    });
}

function createEmptyState(message: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = 'empty-state';
  element.textContent = message;
  return element;
}

/**
 * Prefer the storage layer's user-actionable save message (sync quota, concurrent edit) over a
 * generic fallback so users are not told to retry an operation that can never succeed.
 */
function describeSaveError(error: unknown, fallback: string): string {
  return error instanceof SettingsSaveError ? error.message : fallback;
}

function getMatchModeSelectValue(selectId: string): FilterMatchMode {
  const value = getElementByIdOrNull<HTMLSelectElement>(selectId)?.value;
  if (value === 'contains' || value === 'exact' || value === 'regex') {
    return value;
  }
  return 'contains';
}

/**
 * Resolve a pattern input into what should be stored, or null when it can't be used.
 *
 * Whitespace around a pasted pattern would stop it matching anything, and a blank pattern matches
 * every URL, so neither is accepted silently. Regex patterns keep their exact text.
 */
function readPatternInput(
  elementId: string,
  matchMode: FilterMatchMode,
  errorId: string
): string | null {
  const input = getElementByIdOrNull<HTMLInputElement>(elementId);
  const raw = input?.value ?? '';
  const pattern = matchMode === 'regex' ? raw : raw.trim();

  const problem =
    pattern.trim() === '' ? 'Enter a pattern to match.' : describeInvalidRegex(pattern, matchMode);
  if (problem) {
    showDialogError(errorId, problem, input);
    input?.focus();
    return null;
  }

  return pattern;
}

function describeInvalidRegex(pattern: string, matchMode: FilterMatchMode): string | null {
  if (matchMode !== 'regex') {
    return null;
  }

  const error = getRegexValidationError(pattern);
  if (!error) return null;

  // The engine's message repeats the pattern ("…: /(/: Unterminated group"); keep only the reason.
  const enginePrefix = 'Invalid regular expression:';
  if (error.startsWith(enginePrefix)) {
    const reason = error.slice(error.lastIndexOf(': ') + 2).replace(/\.$/, '');
    return `${enginePrefix} ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
  }
  return error;
}

function renderFilterItem(filter: Filter): HTMLElement {
  const description = filter.description?.trim();
  const toggleLabel = description
    ? `Toggle filter ${description}`
    : `Toggle filter for ${filter.pattern}`;
  const editLabel = description ? `Edit filter ${description}` : `Edit filter ${filter.pattern}`;

  const item = cloneTemplate<HTMLDivElement>('options-filter-item-template');
  const titleElement = querySelector<HTMLElement>('[data-role="filter-title"]', item);
  const patternElement = querySelector<HTMLElement>('[data-role="filter-pattern"]', item);
  const toggleInput = querySelector<HTMLInputElement>('input[data-action="toggle-filter"]', item);
  const editButton = querySelector<HTMLButtonElement>('button[data-action="edit-filter"]', item);

  if (description) {
    titleElement.textContent = description;
  } else {
    titleElement.remove();
  }

  patternElement.textContent = filter.pattern;
  toggleInput.checked = filter.enabled;
  toggleInput.dataset['filterId'] = filter.id;
  toggleInput.setAttribute('aria-label', toggleLabel);
  editButton.dataset['filterId'] = filter.id;
  setIconButtonLabel(editButton, editLabel);

  // Temporary blocks from the popup say how long they have left; the label is kept current.
  if (isTemporaryFilter(filter)) {
    const expiry = createTemporaryLabel('div', filter.expiresAt);
    expiry.className = 'filter-meta';
    patternElement.after(expiry);
  }

  return item;
}

function renderWhitelistItem(entry: Whitelist): HTMLElement {
  const description = entry.description?.trim();
  const toggleLabel = description
    ? `Toggle exception ${description}`
    : `Toggle exception for ${entry.pattern}`;
  const editLabel = description
    ? `Edit exception ${description}`
    : `Edit exception ${entry.pattern}`;

  const item = cloneTemplate<HTMLDivElement>('options-whitelist-item-template');
  const titleElement = querySelector<HTMLElement>('[data-role="whitelist-title"]', item);
  const patternElement = querySelector<HTMLElement>('[data-role="whitelist-pattern"]', item);
  const toggleInput = querySelector<HTMLInputElement>(
    'input[data-action="toggle-whitelist"]',
    item
  );
  const editButton = querySelector<HTMLButtonElement>('button[data-action="edit-whitelist"]', item);

  if (description) {
    titleElement.textContent = description;
  } else {
    titleElement.remove();
  }

  patternElement.textContent = entry.pattern;
  toggleInput.checked = entry.enabled;
  toggleInput.dataset['whitelistId'] = entry.id;
  toggleInput.setAttribute('aria-label', toggleLabel);
  editButton.dataset['whitelistId'] = entry.id;
  setIconButtonLabel(editButton, editLabel);

  return item;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderSchedules(): void {
  const schedulesList = getElementByIdOrNull('schedules-list');
  if (!schedulesList) return;

  // Rebuilding the list drops the field an error was tied to, and adding or removing a schedule
  // can resolve it, so start from a clean form.
  clearDialogError('group-error');

  const fragment = document.createDocumentFragment();
  for (const [index, schedule] of temporarySchedules.entries()) {
    const scheduleNumber = index + 1;
    const item = cloneTemplate<HTMLDivElement>('options-schedule-item-template');
    const dayContainer = querySelector<HTMLElement>('[data-role="day-checkboxes"]', item);
    const startInput = querySelector<HTMLInputElement>('input[data-field="startTime"]', item);
    const endInput = querySelector<HTMLInputElement>('input[data-field="endTime"]', item);
    const removeButton = querySelector<HTMLButtonElement>(
      'button[data-action="remove-schedule"]',
      item
    );

    dayContainer.setAttribute('role', 'group');
    dayContainer.setAttribute('aria-label', `Days for schedule ${scheduleNumber}`);
    for (const [dayIndex, day] of DAY_NAMES.entries()) {
      const label = document.createElement('label');
      label.className = 'day-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = schedule.daysOfWeek.includes(dayIndex);
      input.dataset['action'] = 'update-schedule-day';
      input.dataset['scheduleIndex'] = String(index);
      input.dataset['day'] = String(dayIndex);
      input.setAttribute('aria-label', DAY_FULL_NAMES[dayIndex] ?? day);
      label.appendChild(input);
      label.append(day);
      dayContainer.appendChild(label);
    }

    startInput.value = schedule.startTime;
    startInput.dataset['scheduleIndex'] = String(index);
    startInput.setAttribute('aria-label', `Start time for schedule ${scheduleNumber}`);

    endInput.value = schedule.endTime;
    endInput.dataset['scheduleIndex'] = String(index);
    endInput.setAttribute('aria-label', `End time for schedule ${scheduleNumber}`);

    removeButton.dataset['scheduleIndex'] = String(index);
    setIconButtonLabel(removeButton, `Delete schedule ${scheduleNumber}`);

    fragment.appendChild(item);
  }

  // The list is only shown for groups that are not 24/7, which do nothing until scheduled.
  if (temporarySchedules.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = 'Add a schedule to choose when this group blocks.';
    fragment.appendChild(hint);
  }

  schedulesList.replaceChildren(fragment);
}

/**
 * The filter and exception dialogs say which group the item is in, since the dialog covers the card
 * it came from (and a deep link never showed one), and when a temporary filter ends, e.g.
 * "In Work Hours · Temporary · 45m left". Called with no group it clears, so a reopened dialog never
 * shows the previous item's subtitle while its data loads.
 */
function setDialogSubtitle(
  kind: 'filter' | 'whitelist',
  group?: FilterGroup,
  expiresAt?: number
): void {
  const subtitle = getElementByIdOrNull(`${kind}-modal-subtitle`);
  if (!subtitle) return;

  const parts: (Node | string)[] = group ? [`In ${group.name}`] : [];
  if (expiresAt !== undefined) {
    if (parts.length > 0) parts.push(`${META_SEPARATOR} `);
    const expiry = createTemporaryLabel('span', expiresAt);
    expiry.className = 'subtitle-expiry';
    parts.push(expiry);
  }
  subtitle.replaceChildren(...parts);
  subtitle.hidden = parts.length === 0;
}

// ============================================================================
// Filter Modal
// ============================================================================

function openFilterModal(
  filterId?: string,
  groupId?: string,
  fallbackTrigger: HTMLElement | null = null
): void {
  currentEditingFilterId = filterId ?? null;
  currentFilterGroupId = groupId ?? DEFAULT_GROUP_ID;
  const modal = getElementByIdOrNull('filter-modal');
  const title = getElementByIdOrNull('filter-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('filter-form');
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-filter');

  if (!modal || !title || !form) return;

  form.reset();
  clearDialogError('filter-error');
  hideDeleteConfirm('filter');
  updateMatchModeHint('filter');
  title.textContent = filterId ? 'Edit filter' : 'New filter';
  setDialogSubtitle('filter');
  if (deleteButton) {
    deleteButton.hidden = !filterId;
    deleteButton.disabled = !filterId;
  }

  loadData()
    .then((data) => {
      const filter = filterId ? data.filters.find((f) => f.id === filterId) : undefined;
      const selectedGroupId = filter?.groupId ?? groupId ?? DEFAULT_GROUP_ID;
      currentFilterGroupId = selectedGroupId;
      setDialogSubtitle(
        'filter',
        data.groups.find((entry) => entry.id === selectedGroupId),
        filter && isTemporaryFilter(filter) ? filter.expiresAt : undefined
      );

      if (filter) {
        const patternInput = getElementByIdOrNull<HTMLInputElement>('filter-pattern');
        const descInput = getElementByIdOrNull<HTMLInputElement>('filter-description');
        const enabledInput = getElementByIdOrNull<HTMLInputElement>('filter-enabled');
        const matchModeSelect = getElementByIdOrNull<HTMLSelectElement>('filter-match-mode');

        if (patternInput) patternInput.value = filter.pattern;
        if (descInput) descInput.value = filter.description ?? '';
        if (enabledInput) enabledInput.checked = filter.enabled;
        if (matchModeSelect) matchModeSelect.value = filter.matchMode ?? 'contains';
        updateMatchModeHint('filter');
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to load data for filter modal:', error);
    });

  modal.classList.add('active');
  activateModal(modal, '#filter-pattern', fallbackTrigger);
}

function closeFilterModal(): void {
  const modal = getElementByIdOrNull('filter-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
  currentEditingFilterId = null;
  currentFilterGroupId = null;
}

async function handleFilterSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (isDeleteConfirmOpen('filter')) return;

  const isEdit = currentEditingFilterId !== null;
  const description = getElementByIdOrNull<HTMLInputElement>('filter-description')?.value ?? '';
  const groupId = currentFilterGroupId ?? DEFAULT_GROUP_ID;
  const enabled = getElementByIdOrNull<HTMLInputElement>('filter-enabled')?.checked ?? true;
  const matchMode = getMatchModeSelectValue('filter-match-mode');

  const pattern = readPatternInput('filter-pattern', matchMode, 'filter-error');
  if (pattern === null) {
    return;
  }

  let expiresAt: number | undefined;
  if (currentEditingFilterId) {
    const data = await loadData();
    expiresAt = data.filters.find((filter) => filter.id === currentEditingFilterId)?.expiresAt;
  }

  const baseFilter: Filter = {
    id: currentEditingFilterId ?? generateId(),
    pattern,
    description,
    groupId,
    enabled,
    matchMode,
  };
  const filter: Filter = typeof expiresAt === 'number' ? { ...baseFilter, expiresAt } : baseFilter;

  try {
    if (isEdit) {
      await updateFilter(filter);
    } else {
      await addFilter(filter);
    }
    closeFilterModal();
    await renderGroups();
    // Focus has moved back to the page by now, so this is read after the focused control.
    announceStatus(isEdit ? 'Filter saved.' : 'Filter added.');
  } catch (error) {
    console.error('Failed to save filter:', error);
    showDialogError(
      'filter-error',
      describeSaveError(error, 'Failed to save filter. Please try again.')
    );
  }
}

async function handleFilterDelete(): Promise<void> {
  if (!currentEditingFilterId) return;

  try {
    await deleteFilter(currentEditingFilterId);
    closeFilterModal();
    await renderGroups();
    announceStatus('Filter deleted.');
  } catch (error) {
    console.error('Failed to delete filter:', error);
    showDialogError('filter-error', 'Failed to delete filter. Please try again.');
  }
}

// ============================================================================
// Group Modal
// ============================================================================

function openGroupModal(groupId?: string, fallbackTrigger: HTMLElement | null = null): void {
  currentEditingGroupId = groupId ?? null;
  temporarySchedules = [];

  const modal = getElementByIdOrNull('group-modal');
  const title = getElementByIdOrNull('group-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('group-form');
  const schedulesContainer = getElementByIdOrNull('schedules-container');
  const is24x7Checkbox = getElementByIdOrNull<HTMLInputElement>('group-24x7');
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-group');

  if (!modal || !title || !form || !schedulesContainer || !is24x7Checkbox) return;

  form.reset();
  clearDialogError('group-error');
  hideDeleteConfirm('group');
  title.textContent = groupId ? 'Edit group' : 'New group';
  if (deleteButton) {
    const allowDelete = Boolean(groupId && groupId !== DEFAULT_GROUP_ID);
    deleteButton.hidden = !allowDelete;
    deleteButton.disabled = !allowDelete;
  }

  if (groupId && groupId !== DEFAULT_GROUP_ID) {
    loadData()
      .then((data) => {
        const group = data.groups.find((g) => g.id === groupId);
        if (group) {
          const nameInput = getElementByIdOrNull<HTMLInputElement>('group-name');
          if (nameInput) nameInput.value = group.name;
          is24x7Checkbox.checked = group.is24x7;
          temporarySchedules = group.schedules.map((s) => ({
            daysOfWeek: [...s.daysOfWeek],
            startTime: s.startTime,
            endTime: s.endTime,
          }));
          schedulesContainer.hidden = group.is24x7;
          renderSchedules();
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load group data:', error);
      });
  } else {
    schedulesContainer.hidden = false;
    renderSchedules();
  }

  modal.classList.add('active');
  activateModal(modal, '#group-name', fallbackTrigger);
}

function closeGroupModal(): void {
  const modal = getElementByIdOrNull('group-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
  currentEditingGroupId = null;
  temporarySchedules = [];
}

function addScheduleToModal(): void {
  temporarySchedules.push({
    daysOfWeek: [...DEFAULT_SCHEDULE.daysOfWeek],
    startTime: DEFAULT_SCHEDULE.startTime,
    endTime: DEFAULT_SCHEDULE.endTime,
  });
  renderSchedules();
}

async function handleGroupSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (isDeleteConfirmOpen('group')) return;

  const isEdit = currentEditingGroupId !== null;
  const nameInput = getElementByIdOrNull<HTMLInputElement>('group-name');
  const name = nameInput?.value ?? '';
  const is24x7 = getElementByIdOrNull<HTMLInputElement>('group-24x7')?.checked ?? false;

  if (name.trim() === '') {
    showDialogError('group-error', 'Enter a group name.', nameInput);
    nameInput?.focus();
    return;
  }

  // A schedule with no days can never activate, so the group would silently block nothing.
  const emptyScheduleIndex = is24x7
    ? -1
    : temporarySchedules.findIndex((schedule) => schedule.daysOfWeek.length === 0);
  if (emptyScheduleIndex !== -1) {
    const dayGroup = document.querySelectorAll<HTMLElement>(
      '#schedules-list [data-role="day-checkboxes"]'
    )[emptyScheduleIndex];
    showDialogError('group-error', 'Each schedule needs at least one day selected.', dayGroup);
    dayGroup?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    return;
  }

  // A partly cleared time input reads as '' and would save a schedule that can never run.
  const incompleteTime = is24x7
    ? undefined
    : Array.from(
        document.querySelectorAll<HTMLInputElement>('#schedules-list input[type="time"]')
      ).find((input) => !isValidTimeString(input.value));
  if (incompleteTime) {
    showDialogError('group-error', 'Enter a start and end time for each schedule.', incompleteTime);
    incompleteTime.focus();
    return;
  }

  const group: FilterGroup = {
    id: currentEditingGroupId ?? generateId(),
    name,
    is24x7,
    schedules: is24x7 ? [] : temporarySchedules,
  };

  try {
    if (isEdit) {
      await updateGroup(group);
    } else {
      await addGroup(group);
    }
    closeGroupModal();
    await renderGroups();
    announceStatus(isEdit ? 'Group saved.' : 'Group added.');
  } catch (error) {
    console.error('Failed to save group:', error);
    showDialogError(
      'group-error',
      describeSaveError(error, 'Failed to save group. Please try again.')
    );
  }
}

/** Focus falls back to New group, so the announcement says where the group's contents went. */
async function handleGroupDelete(): Promise<void> {
  const groupId = currentEditingGroupId;
  if (!groupId || groupId === DEFAULT_GROUP_ID) return;

  try {
    const data = await loadData();
    const moved = describeGroupContents(data, groupId);
    await deleteGroup(groupId);
    closeGroupModal();
    await renderGroups();
    announceStatus(
      moved
        ? `Group deleted. Its ${moved.text} moved to ${getDefaultGroupName(data)}.`
        : 'Group deleted.'
    );
  } catch (error) {
    console.error('Failed to delete group:', error);
    showDialogError('group-error', 'Failed to delete group. Please try again.');
  }
}

// ============================================================================
// Whitelist Modal
// ============================================================================

function openWhitelistModal(
  whitelistId?: string,
  groupId?: string,
  fallbackTrigger: HTMLElement | null = null
): void {
  currentEditingWhitelistId = whitelistId ?? null;
  currentWhitelistGroupId = groupId ?? DEFAULT_GROUP_ID;
  const modal = getElementByIdOrNull('whitelist-modal');
  const title = getElementByIdOrNull('whitelist-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('whitelist-form');
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-whitelist');

  if (!modal || !title || !form) return;

  form.reset();
  clearDialogError('whitelist-error');
  hideDeleteConfirm('whitelist');
  updateMatchModeHint('whitelist');
  title.textContent = whitelistId ? 'Edit exception' : 'New exception';
  setDialogSubtitle('whitelist');
  if (deleteButton) {
    deleteButton.hidden = !whitelistId;
    deleteButton.disabled = !whitelistId;
  }

  loadData()
    .then((data) => {
      const entry = whitelistId ? data.whitelist.find((w) => w.id === whitelistId) : undefined;
      const selectedGroupId = entry?.groupId ?? groupId ?? DEFAULT_GROUP_ID;
      currentWhitelistGroupId = selectedGroupId;
      setDialogSubtitle(
        'whitelist',
        data.groups.find((group) => group.id === selectedGroupId)
      );

      if (entry) {
        const patternInput = getElementByIdOrNull<HTMLInputElement>('whitelist-pattern');
        const descInput = getElementByIdOrNull<HTMLInputElement>('whitelist-description');
        const enabledInput = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled');
        const matchModeSelect = getElementByIdOrNull<HTMLSelectElement>('whitelist-match-mode');

        if (patternInput) patternInput.value = entry.pattern;
        if (descInput) descInput.value = entry.description ?? '';
        if (enabledInput) enabledInput.checked = entry.enabled;
        if (matchModeSelect) matchModeSelect.value = entry.matchMode ?? 'contains';
        updateMatchModeHint('whitelist');
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to load exception data:', error);
    });

  modal.classList.add('active');
  activateModal(modal, '#whitelist-pattern', fallbackTrigger);
}

function closeWhitelistModal(): void {
  const modal = getElementByIdOrNull('whitelist-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
  currentEditingWhitelistId = null;
  currentWhitelistGroupId = null;
}

async function handleWhitelistSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (isDeleteConfirmOpen('whitelist')) return;

  const isEdit = currentEditingWhitelistId !== null;
  const description = getElementByIdOrNull<HTMLInputElement>('whitelist-description')?.value ?? '';
  const groupId = currentWhitelistGroupId ?? DEFAULT_GROUP_ID;
  const enabled = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled')?.checked ?? true;
  const matchMode = getMatchModeSelectValue('whitelist-match-mode');

  const pattern = readPatternInput('whitelist-pattern', matchMode, 'whitelist-error');
  if (pattern === null) {
    return;
  }

  const entry: Whitelist = {
    id: currentEditingWhitelistId ?? generateId(),
    pattern,
    description,
    groupId,
    enabled,
    matchMode,
  };

  try {
    if (isEdit) {
      await updateWhitelist(entry);
    } else {
      await addWhitelist(entry);
    }
    closeWhitelistModal();
    await renderGroups();
    announceStatus(isEdit ? 'Exception saved.' : 'Exception added.');
  } catch (error) {
    console.error('Failed to save exception:', error);
    showDialogError(
      'whitelist-error',
      describeSaveError(error, 'Failed to save exception. Please try again.')
    );
  }
}

async function handleWhitelistDelete(): Promise<void> {
  if (!currentEditingWhitelistId) return;

  try {
    await deleteWhitelist(currentEditingWhitelistId);
    closeWhitelistModal();
    await renderGroups();
    announceStatus('Exception deleted.');
  } catch (error) {
    console.error('Failed to delete exception:', error);
    showDialogError('whitelist-error', 'Failed to delete exception. Please try again.');
  }
}

// ============================================================================
// Event Handlers for List Actions
// ============================================================================

function handleGroupsListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement | null;
  if (!button) return;

  const action = button.dataset['action'];
  const groupId = button.dataset['groupId'];
  const filterId = button.dataset['filterId'];
  const whitelistId = button.dataset['whitelistId'];

  if (action === 'toggle-group-open') {
    const groupElement = button.closest<HTMLElement>('.group-item');
    if (groupElement) {
      setGroupOpen(groupElement, !groupElement.classList.contains('is-open'));
    }
  } else if (action === 'edit-group' && groupId) {
    openGroupModal(groupId);
  } else if (action === 'add-filter' && groupId) {
    openFilterModal(undefined, groupId);
  } else if (action === 'add-whitelist' && groupId) {
    openWhitelistModal(undefined, groupId);
  } else if (action === 'edit-filter' && filterId) {
    openFilterModal(filterId);
  } else if (action === 'edit-whitelist' && whitelistId) {
    openWhitelistModal(whitelistId);
  }
}

function handleGroupsListChange(e: Event): void {
  const target = e.target as HTMLElement;
  const input = target.closest('input[data-action]') as HTMLInputElement | null;

  if (!input) return;

  if (input.dataset['action'] === 'toggle-filter') {
    const filterId = input.dataset['filterId'];
    if (filterId) {
      void toggleFilter(filterId, input.checked);
    }
  } else if (input.dataset['action'] === 'toggle-group') {
    const groupId = input.dataset['groupId'];
    if (groupId) {
      void toggleGroupEnabled(groupId, input.checked);
    }
  } else if (input.dataset['action'] === 'toggle-whitelist') {
    const whitelistId = input.dataset['whitelistId'];
    if (whitelistId) {
      void toggleWhitelistEntry(whitelistId, input.checked);
    }
  }
}

function handleSchedulesListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement | null;
  const input = target.closest('input[data-action]') as HTMLInputElement | null;

  if (button?.dataset['action'] === 'remove-schedule') {
    const scheduleIndex = parseInt(button.dataset['scheduleIndex'] ?? '', 10);
    if (!isNaN(scheduleIndex)) {
      removeSchedule(scheduleIndex);
    }
  } else if (input) {
    const action = input.dataset['action'];
    const scheduleIndex = parseInt(input.dataset['scheduleIndex'] ?? '', 10);

    if (isNaN(scheduleIndex)) return;

    if (action === 'update-schedule-day') {
      const day = parseInt(input.dataset['day'] ?? '', 10);
      if (!isNaN(day)) {
        updateScheduleDay(scheduleIndex, day, input.checked);
      }
    } else if (action === 'update-schedule-time') {
      const field = input.dataset['field'];
      if (field === 'startTime' || field === 'endTime') {
        updateScheduleTime(scheduleIndex, field, input.value);
      }
    }
  }
}

function handleGlobalKeydown(e: KeyboardEvent): void {
  if (activeModal && e.key === 'Tab') {
    trapFocus(e, activeModal);
    return;
  }

  if (e.key !== 'Escape') return;

  const filterModal = getElementByIdOrNull('filter-modal');
  const groupModal = getElementByIdOrNull('group-modal');
  const whitelistModal = getElementByIdOrNull('whitelist-modal');

  if (filterModal?.classList.contains('active')) {
    closeFilterModal();
  } else if (groupModal?.classList.contains('active')) {
    closeGroupModal();
  } else if (whitelistModal?.classList.contains('active')) {
    closeWhitelistModal();
  }
}

// ============================================================================
// Helper Actions
// ============================================================================

async function toggleFilter(filterId: string, enabled: boolean): Promise<void> {
  const data = await loadData();
  const filter = data.filters.find((f) => f.id === filterId);
  if (filter) {
    await updateFilter({ ...filter, enabled });
  }
}

/**
 * Persist a group's enabled state through the normal storage save path so all views refresh.
 */
async function toggleGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
  const data = await loadData();
  const group = data.groups.find((entry) => entry.id === groupId);
  if (group) {
    await updateGroup({ ...group, enabled });
  }
}

async function toggleWhitelistEntry(whitelistId: string, enabled: boolean): Promise<void> {
  const data = await loadData();
  const entry = data.whitelist.find((w) => w.id === whitelistId);
  if (entry) {
    await updateWhitelist({ ...entry, enabled });
  }
}

function updateScheduleDay(scheduleIndex: number, day: number, checked: boolean): void {
  const schedule = temporarySchedules[scheduleIndex];
  if (!schedule) return;

  if (checked) {
    if (!schedule.daysOfWeek.includes(day)) {
      schedule.daysOfWeek.push(day);
      schedule.daysOfWeek.sort((a, b) => a - b);
    }
  } else {
    schedule.daysOfWeek = schedule.daysOfWeek.filter((d) => d !== day);
  }
}

function updateScheduleTime(
  scheduleIndex: number,
  field: 'startTime' | 'endTime',
  value: string
): void {
  const schedule = temporarySchedules[scheduleIndex];
  if (!schedule) return;
  schedule[field] = value;
}

/** The removed schedule's button is gone, so focus moves to its neighbor or New schedule. */
function removeSchedule(scheduleIndex: number): void {
  temporarySchedules.splice(scheduleIndex, 1);
  renderSchedules();

  const nextIndex = Math.min(scheduleIndex, temporarySchedules.length - 1);
  const nextButton = getElementByIdOrNull('schedules-list')?.querySelector<HTMLElement>(
    `[data-action="remove-schedule"][data-schedule-index="${nextIndex}"]`
  );
  (nextButton ?? getElementByIdOrNull('add-schedule-btn'))?.focus();
}

// Initialize on load
init().catch((error: unknown) => {
  console.error('Failed to initialize options page:', error);
});
