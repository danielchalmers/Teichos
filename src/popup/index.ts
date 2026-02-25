/**
 * Popup Entry Point
 */

import {
  addFilter,
  clearSnooze,
  deleteFilter,
  loadData,
  saveData,
  setSnooze,
  updateFilter,
} from '../shared/api';
import { getExtensionUrl, openOptionsPage, openOptionsPageWithParams } from '../shared/api/runtime';
import { getActiveTab, updateTabUrl } from '../shared/api/tabs';
import { DEFAULT_GROUP_ID, MessageType, STORAGE_KEY } from '../shared/types';
import {
  buildBlockingIndex,
  buildGroupById,
  formatDuration,
  generateId,
  getScheduleContext,
  getSnoozeRemainingMs,
  getTemporaryFilterRemainingMs,
  isFilterScheduledActive,
  isInternalUrl,
  isSnoozeActive,
  isTemporaryFilter,
  isTemporaryFilterExpired,
  matchesPattern,
  shouldBlockUrlWithIndex,
  sortFiltersTemporaryFirst,
} from '../shared/utils';
import { cloneTemplate, getElementByIdOrNull, querySelector } from '../shared/utils/dom';
import type { SnoozeState, StorageData } from '../shared/types';
import { PAGES } from '../shared/constants';

let cachedData: StorageData | null = null;
let snoozeTickerId: number | null = null;
let lastSnoozeActive = false;

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

async function disableExpiredTemporaryFilters(data: StorageData): Promise<StorageData> {
  const now = Date.now();
  let didUpdate = false;
  const filters = data.filters.map((filter) => {
    if (isTemporaryFilterExpired(filter, now) && filter.enabled) {
      didUpdate = true;
      return { ...filter, enabled: false };
    }
    return filter;
  });

  if (!didUpdate) {
    return data;
  }

  const updated = { ...data, filters };
  await saveData(updated);
  return updated;
}

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  await renderFilters();
  setupEventListeners();
  setupStorageSync();
  ensureSnoozeCountdownTicker();
}

/**
 * Set up event listeners for popup interactions
 */
function setupEventListeners(): void {
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: MessageType.CLOSE_INFO_PANEL });
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

function announceStatus(message: string): void {
  const status = getElementByIdOrNull('status-message');
  if (!status) return;
  status.textContent = '';
  window.setTimeout(() => {
    status.textContent = message;
  }, 0);
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
  const resumeButton = document.querySelector<HTMLButtonElement>('button[data-action="resume-snooze"]');

  if (snoozeTrigger) {
    const statusLabel = describeSnoozeStatus(snooze);
    snoozeTrigger.classList.toggle('is-snoozed', isActive);
    snoozeTrigger.setAttribute('aria-label', statusLabel);
    snoozeTrigger.title = statusLabel;
  }

  if (snoozeLabel) {
    snoozeLabel.textContent = describeSnoozeButtonLabel(snooze);
  }

  if (quickAddButton) {
    quickAddButton.disabled = isActive;
    quickAddButton.setAttribute(
      'aria-label',
      isActive ? 'Temporary filters are unavailable while snoozed' : 'New temporary filter'
    );
    quickAddButton.title = isActive
      ? 'Temporary filters are unavailable while snoozed'
      : 'New temporary filter';
  }

  if (isActive && quickAddPopover) {
    quickAddPopover.classList.remove('is-open');
    quickAddPopover.setAttribute('aria-hidden', 'true');
    quickAddPopover.setAttribute('inert', '');
    if (quickAddButton) {
      quickAddButton.setAttribute('aria-expanded', 'false');
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
    dialog.classList.toggle('is-open', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
    dialog.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) {
      dialog.removeAttribute('inert');
    } else {
      dialog.setAttribute('inert', '');
      if (returnFocus) {
        trigger.focus();
      }
    }
  };

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

    const actionButton = target.closest<HTMLButtonElement>('button[data-action], button[data-snooze-minutes]');
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
        announceStatus('Enter a valid snooze duration.');
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
    if (event.key !== 'Escape' || !dialog.classList.contains('is-open')) {
      return;
    }
    const returnFocus = dialog.contains(document.activeElement);
    setOpen(false, returnFocus);
  });
}

async function applySnoozeSelection(
  value: number | 'off',
  onComplete: () => void
): Promise<void> {
  try {
    if (value === 'off') {
      await clearSnooze();
    } else {
      await setSnooze({ active: true, until: Date.now() + value * 60_000 });
    }

    const latestData = await loadData();
    cachedData = latestData;
    if (isSnoozeActive(latestData.snooze)) {
      await restoreBlockedPageIfUnblocked(latestData).catch((error: unknown) => {
        console.error('Failed to restore blocked page:', error);
      });
      announceStatus(describeSnoozeStatus(latestData.snooze));
    } else {
      await blockActiveTabIfNowBlocked(latestData).catch((error: unknown) => {
        console.error('Failed to block page after snooze ended:', error);
      });
      announceStatus('Filtering resumed.');
    }

    await renderFilters();
    onComplete();
  } catch (error) {
    console.error('Failed to update snooze state:', error);
    announceStatus('Failed to update snooze setting.');
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
    const checkbox = target.closest<HTMLInputElement>(
      'input[type="checkbox"][data-filter-id]'
    );
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
    popover.classList.toggle('is-open', isOpen);
    popover.setAttribute('aria-hidden', String(!isOpen));
    openButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      popover.removeAttribute('inert');
    } else {
      popover.setAttribute('inert', '');
      if (returnFocus) {
        openButton.focus();
      }
    }
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
      return;
    }
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
    announceStatus('Enter a site or pattern to block.');
    patternInput.focus();
    return;
  }

  const durationValue = Number(durationInput.value);
  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    announceStatus('Enter a valid duration.');
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
    announceStatus('Enter a valid duration.');
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
    await blockActiveTabIfMatched(filter);
    announceStatus(`Temporary filter added for ${formatDuration(durationMs)}.`);
    patternInput.value = '';
    await renderFilters();
    onClose();
  } catch (error) {
    console.error('Failed to add temporary filter:', error);
    announceStatus('Failed to add temporary filter.');
  }
}

async function getSuggestedPattern(): Promise<string | null> {
  const activeTab = await getActiveTab();
  const url = activeTab?.url;
  if (!url || isInternalUrl(url)) {
    return null;
  }

  return url;
}

async function blockActiveTabIfMatched(filter: {
  readonly pattern: string;
  readonly matchMode: 'contains' | 'exact' | 'regex';
}): Promise<void> {
  const data = cachedData ?? (await loadData());
  if (isSnoozeActive(data.snooze)) {
    return;
  }

  const activeTab = await getActiveTab();
  if (!activeTab?.id || !activeTab.url) {
    return;
  }

  const url = activeTab.url;
  if (isInternalUrl(url)) {
    return;
  }

  if (!matchesPattern(url, filter.pattern, filter.matchMode)) {
    return;
  }

  const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(url)}`;
  await updateTabUrl(activeTab.id, blockedUrl);
}

async function handleCopyPattern(
  pattern: string,
  button: HTMLButtonElement
): Promise<void> {
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
    if (checkbox.checked) {
      await blockActiveTabIfNowBlocked(latestData).catch((error: unknown) => {
        console.error('Failed to block active page:', error);
      });
    } else {
      await restoreBlockedPageIfUnblocked(latestData).catch((error: unknown) => {
        console.error('Failed to restore blocked page:', error);
      });
    }
    await renderFilters();
    const refreshedToggle = document.querySelector<HTMLInputElement>(
      `input[type="checkbox"][data-filter-id="${filterId}"]`
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
    await restoreBlockedPageIfUnblocked(latestData).catch((error: unknown) => {
      console.error('Failed to restore blocked page:', error);
    });
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
  data = await disableExpiredTemporaryFilters(data);
  cachedData = data;
  lastSnoozeActive = isSnoozeActive(data.snooze);
  applySnoozeVisualState(data.snooze);
  const filterList = getElementByIdOrNull('filter-list');

  if (!filterList) {
    console.error('Filter list element not found');
    return;
  }

  if (data.filters.length === 0) {
    const emptyState = cloneTemplate<HTMLDivElement>('popup-empty-state-template');
    filterList.replaceChildren(emptyState);
    return;
  }

  const activeTab = await getActiveTab();
  const activeUrl = activeTab?.url;
  const isUrlEligible =
    Boolean(activeUrl) && activeUrl ? !isInternalUrl(activeUrl) : false;

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
    if (!isFilterScheduledActive(filter, groupsById, scheduleContext)) {
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
    const displayName = description || filter.pattern;
    const toggleLabel = description
      ? `Toggle filter ${description}`
      : `Toggle filter for ${filter.pattern}`;

    const item = cloneTemplate<HTMLDivElement>('popup-filter-item-template');
    const nameElement = querySelector<HTMLElement>('.filter-name', item);
    const metaElement = item.querySelector<HTMLElement>('.filter-meta');
    const groupElement = querySelector<HTMLElement>('.filter-group', item);
    const toggleWrapper = item.querySelector<HTMLLabelElement>('label.toggle');
    const toggleInput = toggleWrapper?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
    const copyButton = querySelector<HTMLButtonElement>('button[data-action="copy-url"]', item);
    const editButton = querySelector<HTMLButtonElement>('button[data-action="edit-filter"]', item);
    const deleteButton = querySelector<HTMLButtonElement>('button[data-action="delete-filter"]', item);

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

    copyButton.dataset['pattern'] = filter.pattern;
    editButton.dataset['filterId'] = filter.id;
    deleteButton.dataset['filterId'] = filter.id;

    fragment.appendChild(item);
  }

  const inactiveSummary = createInactiveSummary(inactiveCount);
  if (inactiveSummary) {
    fragment.appendChild(inactiveSummary);
  }

  filterList.replaceChildren(fragment);
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

function getBlockedTargetUrl(tabUrl: string): string | null {
  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  if (!tabUrl.startsWith(blockedPageUrl)) {
    return null;
  }

  try {
    const parsedUrl = new URL(tabUrl);
    const blockedTargetUrl = parsedUrl.searchParams.get('url');
    return blockedTargetUrl && !isInternalUrl(blockedTargetUrl) ? blockedTargetUrl : null;
  } catch {
    return null;
  }
}

async function restoreBlockedPageIfUnblocked(data: StorageData): Promise<void> {
  const activeTab = await getActiveTab();
  if (!activeTab?.id || !activeTab.url) {
    return;
  }

  const blockedTargetUrl = getBlockedTargetUrl(activeTab.url);
  if (!blockedTargetUrl) {
    return;
  }

  if (isSnoozeActive(data.snooze)) {
    await updateTabUrl(activeTab.id, blockedTargetUrl);
    return;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  const blockingFilter = shouldBlockUrlWithIndex(blockedTargetUrl, blockingIndex);
  if (blockingFilter) {
    return;
  }

  await updateTabUrl(activeTab.id, blockedTargetUrl);
}

async function blockActiveTabIfNowBlocked(data: StorageData): Promise<void> {
  if (isSnoozeActive(data.snooze)) {
    return;
  }

  const activeTab = await getActiveTab();
  if (!activeTab?.id || !activeTab.url) {
    return;
  }

  const activeUrl = activeTab.url;
  if (getBlockedTargetUrl(activeUrl) || isInternalUrl(activeUrl)) {
    return;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  const blockingFilter = shouldBlockUrlWithIndex(activeUrl, blockingIndex);
  if (!blockingFilter) {
    return;
  }

  const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(activeUrl)}`;
  await updateTabUrl(activeTab.id, blockedUrl);
}

// Initialize on load
init().catch((error: unknown) => {
  console.error('Failed to initialize popup:', error);
});
