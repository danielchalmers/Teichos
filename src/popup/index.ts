/**
 * Popup Entry Point
 */

import { loadData, updateFilter } from '../shared/api';
import { openOptionsPage, openOptionsPageWithParams } from '../shared/api/runtime';
import { escapeHtml } from '../shared/utils';
import { getElementByIdOrNull } from '../shared/utils/dom';
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
  setupInfoPopover();

  const openOptionsButton = getElementByIdOrNull('open-options');
  openOptionsButton?.addEventListener('click', () => {
    openOptionsPage()
      .catch((error: unknown) => {
        console.error('Failed to open options page:', error);
      })
      .finally(() => {
        window.close();
      });
  });
}

function setupInfoPopover(): void {
  const popover = document.querySelector<HTMLElement>('.info-popover');
  if (!popover) return;

  const button = popover.querySelector<HTMLButtonElement>('.info-button');
  if (!button) return;

  const setOpen = (isOpen: boolean): void => {
    popover.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
  };

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
    if (event.key === 'Escape') {
      setOpen(false);
    }
  });
}

function getCopyIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" role="img">
      <path d="M6 6.5h6v7H6z" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M4 9.5H3.5A1.5 1.5 0 0 1 2 8V3.5A1.5 1.5 0 0 1 3.5 2H8a1.5 1.5 0 0 1 1.5 1.5V4" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `;
}

function getEditIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" role="img">
      <path d="M3 11.5V13h1.5l7-7-1.5-1.5-7 7z" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.5 4.5l1.5-1.5 1.5 1.5-1.5 1.5-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `;
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
        <button class="button" id="add-first-filter">+ New Filter</button>
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
          <div class="filter-group">Group • ${escapeHtml(groupName)}</div>
        </div>
        <div class="quick-actions-bottom">
          <label class="toggle">
            <input type="checkbox" data-filter-id="${filter.id}" ${filter.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <div class="quick-actions right">
            <button class="icon-button" type="button" data-action="copy-url" data-pattern="${escapeHtml(filter.pattern)}" aria-label="Copy URL" title="Copy URL">
              ${getCopyIcon()}
            </button>
            <button class="icon-button" type="button" data-action="edit-filter" data-filter-id="${filter.id}" aria-label="Edit Filter" title="Edit Filter">
              ${getEditIcon()}
            </button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  const copyButtons = filterList.querySelectorAll<HTMLButtonElement>(
    'button[data-action="copy-url"]'
  );
  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const pattern = button.dataset['pattern'] ?? '';
      if (!pattern) return;
      try {
        await copyText(pattern);
      } catch (error) {
        console.error('Failed to copy URL:', error);
      }
    });
  });

  const editButtons = filterList.querySelectorAll<HTMLButtonElement>(
    'button[data-action="edit-filter"]'
  );
  editButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filterId = button.dataset['filterId'];
      if (!filterId) return;
      openOptionsPageWithParams({ editFilter: filterId })
        .catch((error: unknown) => {
          console.error('Failed to open filter edit view:', error);
        })
        .finally(() => {
          window.close();
        });
    });
  });

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
