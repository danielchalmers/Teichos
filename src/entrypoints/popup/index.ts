/**
 * Popup Entry Point
 */

import {
  addFilter,
  clearSnooze,
  deleteFilter,
  loadData,
  purgeExpiredTemporaryFilters,
  setSnooze,
  updateFilter,
  SettingsSaveError,
} from '../../shared/api/storage';
import { sendExtensionMessage } from '../../shared/api/messaging';
import { openOptionsPage, openOptionsPageWithParams } from '../../shared/api/runtime';
import { getActiveTab } from '../../shared/api/tabs';
import { matchesPattern } from '../../shared/filtering/patterns';
import {
  buildGroupById,
  getFilterEffectiveState,
  getScheduleContext,
  getSnoozeRemainingMs,
  getTemporaryFilterRemainingMs,
  isSnoozeActive,
  isTemporaryFilter,
  sortFiltersTemporaryFirst,
} from '../../shared/filtering/schedules';
import { DEFAULT_GROUP_ID, MessageType, STORAGE_KEY } from '../../shared/types';
import {
  announceStatus,
  clearDialogError,
  cloneTemplate,
  getElementByIdOrNull,
  querySelector,
  showDialogError,
} from '../../shared/utils/dom';
import { formatDuration, generateId, isInternalUrl } from '../../shared/utils/helpers';
import type { SnoozeState, StorageData } from '../../shared/types';

let cachedData: StorageData | null = null;
let snoozeTickerId: number | null = null;
let lastSnoozeActive = false;
let closeQuickAddDialog: (() => void) | null = null;

/** Controls in the filter list that can take focus, skipping the per-row buttons that are hidden. */
const FILTER_LIST_FOCUSABLE = 'button:not([hidden]):not(:disabled), input:not(:disabled)';

interface FilterListFocus {
  readonly filterId: string | undefined;
  readonly controlSelector: string | null;
  readonly rowIndex: number;
}

function updateSnoozeCountdownTick(): void {
  const snooze = cachedData?.snooze;
  if (!snooze) {
    return;
  }

  const wasActive = lastSnoozeActive;
  const isActive = isSnoozeActive(snooze);
  applySnoozeVisualState(snooze);
  lastSnoozeActive = isActive;

  if (wasActive && !isActive) {
    void renderFilters().catch((error: unknown) => {
      console.error('Failed to refresh filters after snooze expired:', error);
    });
  }
}

function ensureSnoozeCountdownTicker(): void {
  if (snoozeTickerId !== null) {
    return;
  }

  snoozeTickerId = window.setInterval(() => {
    updateSnoozeCountdownTick();
  }, 1000);

  window.addEventListener('unload', () => {
    if (snoozeTickerId === null) {
      return;
    }
    window.clearInterval(snoozeTickerId);
    snoozeTickerId = null;
  });
}

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  setupEventListeners();
  setupStorageSync();
  ensureSnoozeCountdownTicker();
  await renderFilters();
  document.documentElement.dataset['popupReady'] = 'true';
}

/**
 * Set up event listeners for popup interactions
 */
function setupEventListeners(): void {
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    void sendExtensionMessage({ type: MessageType.CLOSE_INFO_PANEL });
    openOptionsPage()
      .catch((error: unknown) => {
        console.error('Failed to open options page:', error);
      })
      .finally(() => {
        window.close();
      });
  });
  setupSnoozePopover();
  setupQuickAdd();
  setupFilterListEvents();
}

function setupStorageSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes[STORAGE_KEY]) return;
    void renderFilters().catch((error: unknown) => {
      console.error('Failed to refresh filters:', error);
    });
  });
}

/**
 * The dialogs cover the whole popup, so make everything behind an open dialog inert: keyboard
 * focus cannot reach controls hidden under the backdrop. The dialogs and the status region are
 * siblings of these, so they stay available.
 */
function setBackgroundInert(isInert: boolean): void {
  document
    .querySelectorAll<HTMLElement>('body > header, body > main, body > footer')
    .forEach((element) => {
      element.inert = isInert;
    });
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

const copyFeedbackTimers = new WeakMap<HTMLButtonElement, number>();

function showCopyFeedback(button: HTMLButtonElement): void {
  const existingTimer = copyFeedbackTimers.get(button);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  button.classList.remove('is-copied');
  void button.offsetWidth;
  button.classList.add('is-copied');

  const timeoutId = window.setTimeout(() => {
    button.classList.remove('is-copied');
    copyFeedbackTimers.delete(button);
  }, 900);

  copyFeedbackTimers.set(button, timeoutId);
}

function describeSnoozeStatus(snooze: SnoozeState): string {
  if (!isSnoozeActive(snooze)) {
    return 'Filtering is active.';
  }

  const remainingMs = getSnoozeRemainingMs(snooze);
  if (remainingMs === null) {
    return 'Snoozed until you resume filtering.';
  }

  return `Snoozed for ${formatDuration(remainingMs)} more.`;
}

function describeSnoozeButtonLabel(snooze: SnoozeState): string {
  if (!isSnoozeActive(snooze)) {
    return 'Active';
  }

  const remainingMs = getSnoozeRemainingMs(snooze);
  if (remainingMs === null) {
    return 'Snoozed: Always';
  }

  return `Snoozed: ${formatDuration(remainingMs)}`;
}

function applySnoozeVisualState(snooze: SnoozeState): void {
  const isActive = isSnoozeActive(snooze);
  const snoozeTrigger = getElementByIdOrNull<HTMLButtonElement>('open-snooze');
  const snoozeLabel = getElementByIdOrNull('snooze-label');
  const quickAddButton = getElementByIdOrNull<HTMLButtonElement>('open-quick-add');
  const quickAddPopover = getElementByIdOrNull('quick-add');
  const resumeButton = document.querySelector<HTMLButtonElement>(
    'button[data-action="resume-snooze"]'
  );

  const buttonLabel = describeSnoozeButtonLabel(snooze);

  if (snoozeTrigger) {
    snoozeTrigger.classList.toggle('is-snoozed', isActive);
    // The name starts with the visible text so voice control can target what is on screen; the
    // longer status becomes the description through the title.
    snoozeTrigger.setAttribute('aria-label', `${buttonLabel}, snooze filtering`);
    snoozeTrigger.title = describeSnoozeStatus(snooze);
  }

  if (snoozeLabel) {
    snoozeLabel.textContent = buttonLabel;
  }

  if (quickAddButton) {
    quickAddButton.disabled = isActive;
    quickAddButton.title = isActive
      ? 'Temporary blocks are unavailable while snoozed'
      : 'New temporary block';
  }

  if (isActive && quickAddPopover?.classList.contains('is-open')) {
    const hadFocus = quickAddPopover.contains(document.activeElement);
    closeQuickAddDialog?.();
    if (hadFocus) {
      snoozeTrigger?.focus();
    }
  }

  if (resumeButton) {
    resumeButton.hidden = !isActive;
  }

  const content = document.querySelector<HTMLElement>('.content');
  content?.classList.toggle('is-snoozed', isActive);
}

function setupSnoozePopover(): void {
  const trigger = getElementByIdOrNull<HTMLButtonElement>('open-snooze');
  const dialog = getElementByIdOrNull('snooze-dialog');
  const customDurationInput = getElementByIdOrNull<HTMLInputElement>('snooze-custom-duration');
  const customUnitSelect = getElementByIdOrNull<HTMLSelectElement>('snooze-custom-unit');

  if (!trigger || !dialog) {
    return;
  }

  const setOpen = (isOpen: boolean, returnFocus = false): void => {
    const wasOpen = dialog.classList.contains('is-open');
    dialog.classList.toggle('is-open', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
    dialog.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) {
      dialog.removeAttribute('inert');
      setBackgroundInert(true);
      if (!wasOpen) {
        dialog.querySelector<HTMLElement>('.snooze-option')?.focus();
      }
    } else {
      dialog.setAttribute('inert', '');
      clearDialogError('snooze-error');
      if (wasOpen) {
        setBackgroundInert(false);
      }
      if (returnFocus) {
        trigger.focus();
      }
    }
  };

  const clearCustomError = (): void => {
    clearDialogError('snooze-error');
  };
  customDurationInput?.addEventListener('input', clearCustomError);
  customUnitSelect?.addEventListener('input', clearCustomError);

  const resolveCustomMinutes = (): number | null => {
    const durationValue = customDurationInput ? Number(customDurationInput.value) : Number.NaN;
    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      return null;
    }

    const unit = customUnitSelect?.value ?? 'minutes';
    const minutesByUnit: Record<string, number> = {
      minutes: 1,
      hours: 60,
      days: 1_440,
    };
    const minutes = Math.round(durationValue * (minutesByUnit[unit] ?? 0));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return minutes;
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!dialog.classList.contains('is-open'));
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const closeAction = target.closest<HTMLElement>('[data-action="close-snooze-dialog"]');
    if (closeAction) {
      setOpen(false, true);
      return;
    }

    const actionButton = target.closest<HTMLButtonElement>(
      'button[data-action], button[data-snooze-minutes]'
    );
    if (!actionButton) {
      return;
    }

    if (actionButton.dataset['action'] === 'resume-snooze') {
      void applySnoozeSelection('off', () => setOpen(false, true));
      return;
    }

    if (actionButton.dataset['action'] === 'apply-custom-snooze') {
      const minutes = resolveCustomMinutes();
      if (!minutes) {
        showDialogError('snooze-error', 'Enter a valid snooze duration.', customDurationInput);
        customDurationInput?.focus();
        return;
      }

      void applySnoozeSelection(minutes, () => setOpen(false, true));
      return;
    }

    const minutesRaw = actionButton.dataset['snoozeMinutes'];
    const minutes = minutesRaw ? Number.parseInt(minutesRaw, 10) : Number.NaN;
    if (Number.isFinite(minutes) && minutes > 0) {
      void applySnoozeSelection(minutes, () => setOpen(false, true));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.classList.contains('is-open')) {
      setOpen(false, true);
    }
  });
}

async function applySnoozeSelection(value: number | 'off', onComplete: () => void): Promise<void> {
  try {
    if (value === 'off') {
      await clearSnooze();
    } else {
      await setSnooze({ active: true, until: Date.now() + value * 60_000 });
    }

    const latestData = await loadData();
    cachedData = latestData;
    if (isSnoozeActive(latestData.snooze)) {
      announceStatus(describeSnoozeStatus(latestData.snooze));
    } else {
      announceStatus('Filtering resumed.');
    }

    await renderFilters();
    onComplete();
  } catch (error) {
    console.error('Failed to update snooze state:', error);
    showDialogError('snooze-error', 'Failed to update snooze setting.');
  }
}

function setupFilterListEvents(): void {
  const filterList = getElementByIdOrNull('filter-list');
  if (!filterList) return;

  filterList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;

    const action = button.dataset['action'];
    if (action === 'copy-url') {
      const pattern = button.dataset['pattern'] ?? '';
      if (!pattern) return;
      void handleCopyPattern(pattern, button);
      return;
    }

    if (action === 'edit-filter') {
      const filterId = button.dataset['filterId'];
      if (!filterId) return;
      openOptionsPageWithParams({ editFilter: filterId })
        .catch((error: unknown) => {
          console.error('Failed to open filter edit view:', error);
        })
        .finally(() => {
          window.close();
        });
      return;
    }

    if (action === 'delete-filter') {
      const filterId = button.dataset['filterId'];
      if (!filterId) return;
      void handleDeleteFilter(filterId);
      return;
    }

    if (action === 'add-first-filter') {
      openOptionsPageWithParams({ modal: 'filter' }).catch((error: unknown) => {
        console.error('Failed to open options page:', error);
      });
    }
  });

  filterList.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"][data-filter-id]');
    if (!checkbox) return;
    void handleToggleFilter(checkbox);
  });
}

function setupQuickAdd(): void {
  const openButton = getElementByIdOrNull('open-quick-add');
  const popover = getElementByIdOrNull('quick-add');
  const form = getElementByIdOrNull<HTMLFormElement>('quick-add-form');
  const patternInput = getElementByIdOrNull<HTMLInputElement>('quick-add-pattern');
  const durationInput = getElementByIdOrNull<HTMLInputElement>('quick-add-duration');
  const unitSelect = getElementByIdOrNull<HTMLSelectElement>('quick-add-unit');

  if (!openButton || !popover || !form || !patternInput || !durationInput || !unitSelect) {
    return;
  }

  const setOpen = (isOpen: boolean, returnFocus = false): void => {
    const wasOpen = popover.classList.contains('is-open');
    popover.classList.toggle('is-open', isOpen);
    popover.setAttribute('aria-hidden', String(!isOpen));
    openButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      popover.removeAttribute('inert');
      setBackgroundInert(true);
    } else {
      popover.setAttribute('inert', '');
      clearDialogError('quick-add-error');
      if (wasOpen) {
        setBackgroundInert(false);
      }
      if (returnFocus) {
        openButton.focus();
      }
    }
  };
  closeQuickAddDialog = (): void => {
    setOpen(false);
  };

  const ensureDefaults = (): void => {
    if (!durationInput.value) {
      durationInput.value = '30';
    }
    if (!unitSelect.value) {
      unitSelect.value = 'minutes';
    }
  };

  const openQuickAdd = async (): Promise<void> => {
    setOpen(true);
    ensureDefaults();
    const suggestion = await getSuggestedPattern();
    if (suggestion) {
      patternInput.value = suggestion;
    }
    patternInput.focus();
    patternInput.select();
  };

  openButton.addEventListener('click', () => {
    if (popover.classList.contains('is-open')) {
      setOpen(false, true);
      return;
    }
    void openQuickAdd();
  });

  popover.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
    if (action === 'close-quick-add') {
      setOpen(false, true);
      return;
    }
    if (action === 'open-full-editor') {
      openOptionsPageWithParams({ modal: 'filter' })
        .catch((error: unknown) => {
          console.error('Failed to open full editor:', error);
        })
        .finally(() => {
          window.close();
        });
      return;
    }

    const presetButton = target.closest<HTMLButtonElement>('button[data-duration][data-unit]');
    if (presetButton) {
      durationInput.value = presetButton.dataset['duration'] ?? durationInput.value;
      unitSelect.value = presetButton.dataset['unit'] ?? unitSelect.value;
      clearDialogError('quick-add-error');
      // Setting the fields from script is silent, so confirm the change for screen readers.
      announceStatus(`Duration set to ${presetButton.textContent.trim()}.`);
      return;
    }
  });

  form.addEventListener('input', () => {
    clearDialogError('quick-add-error');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover.classList.contains('is-open')) {
      setOpen(false, true);
    }
  });

  document.addEventListener('click', (event) => {
    if (!popover.classList.contains('is-open')) {
      return;
    }
    const target = event.target as Node;
    if (popover.contains(target) || openButton.contains(target)) {
      return;
    }
    setOpen(false);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleQuickAddSubmit(patternInput, durationInput, unitSelect, () => {
      setOpen(false, true);
    });
  });
}

async function handleQuickAddSubmit(
  patternInput: HTMLInputElement,
  durationInput: HTMLInputElement,
  unitSelect: HTMLSelectElement,
  onClose: () => void
): Promise<void> {
  const pattern = patternInput.value.trim();
  if (!pattern) {
    showDialogError('quick-add-error', 'Enter a site or pattern to block.', patternInput);
    patternInput.focus();
    return;
  }

  const durationValue = Number(durationInput.value);
  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    showDialogError('quick-add-error', 'Enter a valid duration.', durationInput);
    durationInput.focus();
    return;
  }

  const unit = unitSelect.value;
  const unitToMs: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  };
  const durationMs = Math.round(durationValue * (unitToMs[unit] ?? 0));
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    showDialogError('quick-add-error', 'Enter a valid duration.', durationInput);
    durationInput.focus();
    return;
  }

  const expiresAt = Date.now() + durationMs;
  const filter = {
    id: generateId(),
    pattern,
    groupId: DEFAULT_GROUP_ID,
    enabled: true,
    matchMode: 'contains' as const,
    expiresAt,
  };
  try {
    await addFilter(filter);
    announceStatus(`Temporary filter added for ${formatDuration(durationMs)}.`);
    patternInput.value = '';
    await renderFilters();
    onClose();
  } catch (error) {
    console.error('Failed to add temporary filter:', error);
    showDialogError(
      'quick-add-error',
      error instanceof SettingsSaveError ? error.message : 'Failed to add temporary filter.'
    );
  }
}

async function getSuggestedPattern(): Promise<string | null> {
  const activeTab = await getActiveTab();
  const url = activeTab?.url;
  if (!url || isInternalUrl(url)) {
    return null;
  }

  // Suggest just the hostname: the full URL as a "contains" pattern would only
  // match this exact page (path and query included), not the site the user
  // means to block.
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

async function handleCopyPattern(pattern: string, button: HTMLButtonElement): Promise<void> {
  try {
    await copyText(pattern);
    announceStatus('Copied URL pattern to clipboard.');
    showCopyFeedback(button);
  } catch (error) {
    console.error('Failed to copy URL:', error);
    announceStatus('Failed to copy URL pattern.');
  }
}

async function handleToggleFilter(checkbox: HTMLInputElement): Promise<void> {
  const filterId = checkbox.dataset['filterId'];
  if (!filterId) return;

  const originalState = !checkbox.checked;

  try {
    const data = cachedData ?? (await loadData());
    await toggleFilter(data, filterId, checkbox.checked);
    const latestData = await loadData();
    cachedData = latestData;
    await renderFilters();
    const refreshedToggle = document.querySelector<HTMLInputElement>(
      `input[type="checkbox"][data-filter-id="${CSS.escape(filterId)}"]`
    );
    refreshedToggle?.focus();
  } catch (error) {
    console.error('Failed to toggle filter:', error);
    checkbox.checked = originalState;
  }
}

async function handleDeleteFilter(filterId: string): Promise<void> {
  try {
    await deleteFilter(filterId);
    const latestData = await loadData();
    cachedData = latestData;
    await renderFilters();
    announceStatus('Temporary filter deleted.');
  } catch (error) {
    console.error('Failed to delete filter:', error);
    announceStatus('Failed to delete filter.');
  }
}

function createInactiveSummary(inactiveCount: number): HTMLElement | null {
  if (inactiveCount <= 0) {
    return null;
  }

  const summary = cloneTemplate<HTMLDivElement>('popup-inactive-summary-template');
  const label = inactiveCount === 1 ? 'filter' : 'filters';
  summary.textContent = `${inactiveCount} more inactive ${label}`;
  return summary;
}

/**
 * Render the filter list in the popup
 */
async function renderFilters(): Promise<void> {
  let data = await loadData();
  data = await purgeExpiredTemporaryFilters(data);
  cachedData = data;
  lastSnoozeActive = isSnoozeActive(data.snooze);
  applySnoozeVisualState(data.snooze);
  const filterList = getElementByIdOrNull('filter-list');

  if (!filterList) {
    console.error('Filter list element not found');
    return;
  }

  const snoozeActive = isSnoozeActive(data.snooze);

  if (data.filters.length === 0) {
    const emptyState = cloneTemplate<HTMLDivElement>('popup-empty-state-template');
    replaceFilterList(filterList, emptyState, snoozeActive);
    return;
  }

  const activeTab = await getActiveTab();
  const activeUrl = activeTab?.url;
  const isUrlEligible = Boolean(activeUrl) && activeUrl ? !isInternalUrl(activeUrl) : false;

  const groupsById = buildGroupById(data.groups);
  const scheduleContext = getScheduleContext();
  const whitelistedGroups = new Set<string>();
  if (isUrlEligible && activeUrl) {
    const activeUrlLower = activeUrl.toLowerCase();
    for (const entry of data.whitelist) {
      if (!entry.enabled) continue;
      if (matchesPattern(activeUrl, entry.pattern, entry.matchMode, activeUrlLower)) {
        whitelistedGroups.add(entry.groupId);
      }
    }
  }

  const visibleFilters = data.filters.filter((filter) => {
    if (!getFilterEffectiveState(filter, groupsById, scheduleContext).groupActive) {
      return false;
    }
    if (!isTemporaryFilter(filter) && isUrlEligible && whitelistedGroups.has(filter.groupId)) {
      return false;
    }
    return true;
  });
  const inactiveCount = data.filters.length - visibleFilters.length;

  const orderedFilters = sortFiltersTemporaryFirst(visibleFilters);

  const fragment = document.createDocumentFragment();
  for (const filter of orderedFilters) {
    const group = groupsById.get(filter.groupId);
    const groupName = group?.name ?? 'Unknown Group';
    const description = filter.description?.trim();
    let displayName = filter.pattern;
    if (description) {
      displayName = description;
    }
    const toggleLabel = description
      ? `Toggle filter ${description}`
      : `Toggle filter for ${filter.pattern}`;

    const item = cloneTemplate<HTMLDivElement>('popup-filter-item-template');
    const nameElement = querySelector<HTMLElement>('.filter-name', item);
    const metaElement = item.querySelector<HTMLElement>('.filter-meta');
    const groupElement = querySelector<HTMLElement>('.filter-group', item);
    const toggleWrapper = item.querySelector<HTMLLabelElement>('label.toggle');
    const toggleInput =
      toggleWrapper?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
    const copyButton = querySelector<HTMLButtonElement>('button[data-action="copy-url"]', item);
    const editButton = querySelector<HTMLButtonElement>('button[data-action="edit-filter"]', item);
    const deleteButton = querySelector<HTMLButtonElement>(
      'button[data-action="delete-filter"]',
      item
    );

    nameElement.textContent = displayName;
    nameElement.title = displayName;
    const isTemporary = isTemporaryFilter(filter);
    const remainingMs = getTemporaryFilterRemainingMs(filter);
    if (metaElement) {
      metaElement.remove();
    }
    let groupLabel = groupName;
    if (remainingMs !== null) {
      if (remainingMs <= 0) {
        groupLabel = 'Temporary expired';
      } else {
        groupLabel = `Temporary - ${formatDuration(remainingMs)} left`;
      }
    }
    groupElement.textContent = groupLabel;
    groupElement.title = groupLabel;

    editButton.hidden = isTemporary;
    deleteButton.hidden = !isTemporary;

    if (isTemporary) {
      toggleWrapper?.remove();
    } else {
      if (toggleInput) {
        toggleInput.checked = filter.enabled;
        toggleInput.dataset['filterId'] = filter.id;
        toggleInput.setAttribute('aria-label', toggleLabel);
      }
    }

    item.dataset['filterId'] = filter.id;
    copyButton.dataset['pattern'] = filter.pattern;
    copyButton.setAttribute('aria-label', `Copy URL for ${displayName}`);
    editButton.dataset['filterId'] = filter.id;
    editButton.setAttribute('aria-label', `Edit filter ${displayName}`);
    deleteButton.dataset['filterId'] = filter.id;
    deleteButton.setAttribute('aria-label', `Delete filter ${displayName}`);

    fragment.appendChild(item);
  }

  const inactiveSummary = createInactiveSummary(inactiveCount);
  if (inactiveSummary) {
    fragment.appendChild(inactiveSummary);
  }

  replaceFilterList(filterList, fragment, snoozeActive);
}

/**
 * Swap in freshly rendered rows. While snoozed the list is dimmed and blocked for the pointer, so
 * its controls are disabled too, giving keyboard and screen reader users the same read-only state.
 */
function replaceFilterList(filterList: HTMLElement, content: Node, snoozeActive: boolean): void {
  const focus = captureFilterListFocus(filterList);
  filterList.replaceChildren(content);
  filterList
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
    .forEach((control) => {
      control.disabled = snoozeActive;
    });
  restoreFilterListFocus(filterList, focus);
}

function captureFilterListFocus(filterList: HTMLElement): FilterListFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !filterList.contains(active)) {
    return null;
  }

  const row = active.closest<HTMLElement>('.filter-item');
  const action = active.dataset['action'];
  let controlSelector: string | null = null;
  if (action) {
    controlSelector = `[data-action="${action}"]`;
  } else if (active instanceof HTMLInputElement) {
    controlSelector = 'input';
  }

  return {
    filterId: row?.dataset['filterId'],
    controlSelector,
    rowIndex: row ? Array.from(filterList.querySelectorAll('.filter-item')).indexOf(row) : 0,
  };
}

/**
 * Re-rendering replaces every row, so return focus to the same control, or to the row that took
 * a deleted row's place, instead of letting it fall back to the document body.
 */
function restoreFilterListFocus(filterList: HTMLElement, focus: FilterListFocus | null): void {
  if (!focus) {
    return;
  }

  const rows = Array.from(filterList.querySelectorAll<HTMLElement>('.filter-item'));
  const sameRow =
    focus.filterId === undefined
      ? undefined
      : rows.find((row) => row.dataset['filterId'] === focus.filterId);
  const sameControl =
    sameRow && focus.controlSelector
      ? sameRow.querySelector<HTMLElement>(`${focus.controlSelector}:not([hidden]):not(:disabled)`)
      : null;
  const nearbyRow = sameRow ?? rows[Math.min(focus.rowIndex, rows.length - 1)];
  const target =
    sameControl ??
    nearbyRow?.querySelector<HTMLElement>(FILTER_LIST_FOCUSABLE) ??
    filterList.querySelector<HTMLElement>(FILTER_LIST_FOCUSABLE) ??
    getElementByIdOrNull('open-quick-add');
  target?.focus();
}

/**
 * Toggle a filter's enabled state
 */
async function toggleFilter(
  data: StorageData,
  filterId: string,
  enabled: boolean
): Promise<StorageData> {
  const filters = data.filters.map((filter) =>
    filter.id === filterId ? { ...filter, enabled } : filter
  );
  const updated = { ...data, filters };

  const updatedFilter = filters.find((filter) => filter.id === filterId);
  if (updatedFilter) {
    await updateFilter(updatedFilter);
  }

  return updated;
}

// Initialize on load
init().catch((error: unknown) => {
  console.error('Failed to initialize popup:', error);
});
