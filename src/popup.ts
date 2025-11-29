import { loadData, updateFilter } from './storage';
import { Filter, FilterGroup } from './types';

async function init() {
  await renderFilters();
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('open-options')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

async function renderFilters() {
  const data = await loadData();
  const filterList = document.getElementById('filter-list')!;

  if (data.filters.length === 0) {
    filterList.innerHTML = `
      <div class="empty-state">
        <p>No filters configured yet.</p>
        <button class="add-filter-btn" id="add-first-filter">+ Add Filter</button>
      </div>
    `;
    document.getElementById('add-first-filter')!.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  filterList.innerHTML = data.filters.map(filter => {
    const group = data.groups.find(g => g.id === filter.groupId);
    const groupName = group ? group.name : 'Unknown Group';
    const displayName = filter.description || 'Unnamed Filter';

    return `
      <div class="filter-item">
        <div class="filter-info">
          <div class="filter-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="filter-pattern" title="${escapeHtml(filter.pattern)}">${escapeHtml(filter.pattern)}</div>
          <div class="filter-group">Group: ${escapeHtml(groupName)}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-filter-id="${filter.id}" ${filter.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;
  }).join('');

  // Add event listeners for toggle switches
  const toggleInputs = filterList.querySelectorAll('input[type="checkbox"]');
  toggleInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const checkbox = e.target as HTMLInputElement;
      const filterId = checkbox.dataset.filterId!;
      await toggleFilter(filterId, checkbox.checked);
    });
  });
}

async function toggleFilter(filterId: string, enabled: boolean) {
  const data = await loadData();
  const filter = data.filters.find(f => f.id === filterId);
  if (filter) {
    filter.enabled = enabled;
    await updateFilter(filter);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();
