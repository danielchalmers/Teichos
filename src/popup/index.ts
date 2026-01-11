/**
 * Popup Entry Point
 */

import { loadData, updateFilter } from '../shared/api';
import { openOptionsPage, openOptionsPageWithParams } from '../shared/api/runtime';
import { getActiveTab } from '../shared/api/tabs';
import { MessageType, STORAGE_KEY } from '../shared/types';
import {
  buildGroupById,
  getScheduleContext,
  isFilterScheduledActive,
  isInternalUrl,
  matchesPattern,
} from '../shared/utils';
import { cloneTemplate, getElementByIdOrNull, querySelector } from '../shared/utils/dom';
import type { StorageData } from '../shared/types';

let cachedData: StorageData | null = null;

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  await renderFilters();
  setupEventListeners();
  setupStorageSync();
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
  const openInfoButton = getElementByIdOrNull('open-info');
  openInfoButton?.addEventListener('click', () => {
    openOptionsPageWithParams({ info: '1' })
      .catch((error: unknown) => {
        console.error('Failed to open about panel:', error);
      })
      .finally(() => {
        window.close();
      });
  });
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
      void handleCopyPattern(pattern);
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

    if (action === 'add-first-filter') {
      openOptionsPage().catch((error: unknown) => {
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

async function handleCopyPattern(pattern: string): Promise<void> {
  try {
    await copyText(pattern);
    announceStatus('Copied URL pattern to clipboard.');
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
  const data = await loadData();
  cachedData = data;
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
    if (isUrlEligible && whitelistedGroups.has(filter.groupId)) {
      return false;
    }
    return true;
  });
  const inactiveCount = data.filters.length - visibleFilters.length;

  const fragment = document.createDocumentFragment();
  for (const filter of visibleFilters) {
    const group = groupsById.get(filter.groupId);
    const groupName = group?.name ?? 'Unknown Group';
    const description = filter.description?.trim();
    const displayName = description || filter.pattern;
    const toggleLabel = description
      ? `Toggle filter ${description}`
      : `Toggle filter for ${filter.pattern}`;

    const item = cloneTemplate<HTMLDivElement>('popup-filter-item-template');
    const nameElement = querySelector<HTMLElement>('.filter-name', item);
    const groupElement = querySelector<HTMLElement>('.filter-group', item);
    const toggleInput = querySelector<HTMLInputElement>('input[type="checkbox"]', item);
    const copyButton = querySelector<HTMLButtonElement>('button[data-action="copy-url"]', item);
    const editButton = querySelector<HTMLButtonElement>('button[data-action="edit-filter"]', item);

    nameElement.textContent = displayName;
    nameElement.title = displayName;
    groupElement.textContent = groupName;
    groupElement.title = groupName;

    toggleInput.checked = filter.enabled;
    toggleInput.dataset.filterId = filter.id;
    toggleInput.setAttribute('aria-label', toggleLabel);

    copyButton.dataset.pattern = filter.pattern;
    editButton.dataset.filterId = filter.id;

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
): Promise<void> {
  const filter = data.filters.find((f) => f.id === filterId);
  if (filter) {
    await updateFilter({ ...filter, enabled });
  }
}

// Initialize on load
init().catch((error: unknown) => {
  console.error('Failed to initialize popup:', error);
});
