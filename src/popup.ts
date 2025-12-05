import { loadData, updateFilter } from './storage';

async function init(): Promise<void> {
  await renderFilters();
  setupEventListeners();
}

function openOptionsPage(): void {
  chrome.runtime.openOptionsPage(() => {
    if (chrome.runtime.lastError) {
      console.error('Failed to open options page:', chrome.runtime.lastError);
    }
  });
}

function setupEventListeners(): void {
  const openOptionsButton = document.getElementById('open-options');
  if (openOptionsButton) {
    openOptionsButton.addEventListener('click', openOptionsPage);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function renderFilters(): Promise<void> {
  const data = await loadData();
  const filterList = document.getElementById('filter-list');
  
  if (!filterList) {
    console.error('Filter list element not found');
    return;
  }

  if (data.filters.length === 0) {
    filterList.innerHTML = `
      <div class="empty-state">
        <p>No filters configured yet.</p>
        <button class="add-filter-btn" id="add-first-filter">+ Add Filter</button>
      </div>
    `;
    const addFirstFilterButton = document.getElementById('add-first-filter');
    if (addFirstFilterButton) {
      addFirstFilterButton.addEventListener('click', openOptionsPage);
    }
    return;
  }

  filterList.innerHTML = data.filters.map(filter => {
    const group = data.groups.find(g => g.id === filter.groupId);
    const groupName = group?.name ?? 'Unknown Group';
    const displayName = filter.description ?? 'Unnamed Filter';

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
  const toggleInputs = filterList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  toggleInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const checkbox = e.target as HTMLInputElement;
      const filterId = checkbox.dataset['filterId'];
      if (!filterId) return;
      
      const originalState = !checkbox.checked;
      
      try {
        await toggleFilter(filterId, checkbox.checked);
      } catch (error) {
        console.error('Failed to toggle filter:', error);
        // Revert checkbox state on error
        checkbox.checked = originalState;
      }
    });
  });
}

async function toggleFilter(filterId: string, enabled: boolean): Promise<void> {
  const data = await loadData();
  const filter = data.filters.find(f => f.id === filterId);
  if (filter) {
    const updatedFilter = { ...filter, enabled };
    await updateFilter(updatedFilter);
  }
}

init().catch(error => {
  console.error('Failed to initialize popup:', error);
});
