/**
 * Popup Entry Point
 */

import { loadData, updateFilter } from '../shared/api';
import { openOptionsPage } from '../shared/api/runtime';
import { escapeHtml } from '../shared/utils';
import { getElementById, getElementByIdOrNull } from '../shared/utils/dom';
import type { StorageData, Filter } from '../shared/types';

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  await renderFilters();
  setupEventListeners();
}

/**
 * Set up event listeners for popup interactions
 */
function setupEventListeners(): void {
  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage().catch((error: unknown) => {
      console.error('Failed to open options page:', error);
    });
  });
}

/**
 * Render the filter list in the popup
 */
async function renderFilters(): Promise<void> {
  const data = await loadData();
  const filterList = getElementByIdOrNull('filter-list');

  if (!filterList) {
    console.error('Filter list element not found');
    return;
  }

  if (data.filters.length === 0) {
    filterList.innerHTML = `
      <div class="empty-state">
        <p>No filters configured.</p>
        <button class="add-filter-btn" id="add-first-filter">+ New Filter</button>
      </div>
    `;

    const addFirstFilterButton = getElementByIdOrNull('add-first-filter');
    addFirstFilterButton?.addEventListener('click', () => {
      openOptionsPage().catch((error: unknown) => {
        console.error('Failed to open options page:', error);
      });
    });
    return;
  }

  filterList.innerHTML = data.filters
    .map((filter) => {
      const group = data.groups.find((g) => g.id === filter.groupId);
      const groupName = group?.name ?? 'Unknown Group';
      const description = filter.description?.trim();
      const nameMarkup = description
        ? `<div class="filter-name" title="${escapeHtml(description)}">${escapeHtml(description)}</div>`
        : '';

      return `
      <div class="filter-item">
        <div class="filter-info">
          ${nameMarkup}
          <div class="filter-pattern" title="${escapeHtml(filter.pattern)}">${escapeHtml(filter.pattern)}</div>
          <div class="filter-group">Group: ${escapeHtml(groupName)}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-filter-id="${filter.id}" ${filter.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;
    })
    .join('');

  // Add event listeners for toggle switches
  const toggleInputs = filterList.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]'
  );

  toggleInputs.forEach((input) => {
    input.addEventListener('change', async (e: Event) => {
      const checkbox = e.target as HTMLInputElement;
      const filterId = checkbox.dataset['filterId'];
      if (!filterId) return;

      const originalState = !checkbox.checked;

      try {
        await toggleFilter(data, filterId, checkbox.checked);
      } catch (error) {
        console.error('Failed to toggle filter:', error);
        checkbox.checked = originalState;
      }
    });
  });
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
