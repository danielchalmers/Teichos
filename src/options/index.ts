/**
 * Options Page Entry Point
 * Manages filters, groups, and whitelist entries
 */

import {
  loadData,
  addFilter,
  updateFilter,
  deleteFilter,
  addGroup,
  updateGroup,
  deleteGroup,
  addWhitelist,
  updateWhitelist,
  deleteWhitelist,
} from '../shared/api';
import type {
  StorageData,
  Filter,
  FilterGroup,
  Whitelist,
  MutableTimeSchedule,
} from '../shared/types';
import { DEFAULT_GROUP_ID } from '../shared/types';
import { escapeHtml, generateId } from '../shared/utils';
import { getElementByIdOrNull } from '../shared/utils/dom';
import { DAY_NAMES, DEFAULT_SCHEDULE } from '../shared/constants';

// Modal state
let currentEditingFilterId: string | null = null;
let currentEditingGroupId: string | null = null;
let currentEditingWhitelistId: string | null = null;
let temporarySchedules: MutableTimeSchedule[] = [];

/**
 * Initialize options page
 */
async function init(): Promise<void> {
  await renderGroups();
  await renderFilters();
  await renderWhitelist();
  setupEventListeners();
}

/**
 * Set up all event listeners
 */
function setupEventListeners(): void {
  // Add buttons
  getElementByIdOrNull('add-filter-btn')?.addEventListener('click', () =>
    openFilterModal()
  );
  getElementByIdOrNull('add-group-btn')?.addEventListener('click', () =>
    openGroupModal()
  );
  getElementByIdOrNull('add-whitelist-btn')?.addEventListener('click', () =>
    openWhitelistModal()
  );

  // Filter modal
  getElementByIdOrNull('close-filter-modal')?.addEventListener('click', closeFilterModal);
  getElementByIdOrNull('cancel-filter')?.addEventListener('click', closeFilterModal);
  getElementByIdOrNull('filter-form')?.addEventListener('submit', handleFilterSubmit);

  // Group modal
  getElementByIdOrNull('close-group-modal')?.addEventListener('click', closeGroupModal);
  getElementByIdOrNull('cancel-group')?.addEventListener('click', closeGroupModal);
  getElementByIdOrNull('group-form')?.addEventListener('submit', handleGroupSubmit);
  getElementByIdOrNull('add-schedule-btn')?.addEventListener('click', addScheduleToModal);
  getElementByIdOrNull('group-24x7')?.addEventListener('change', (e: Event) => {
    const is24x7 = (e.target as HTMLInputElement).checked;
    const schedulesContainer = getElementByIdOrNull('schedules-container');
    if (schedulesContainer) {
      schedulesContainer.style.display = is24x7 ? 'none' : 'block';
    }
  });

  // Whitelist modal
  getElementByIdOrNull('close-whitelist-modal')?.addEventListener('click', closeWhitelistModal);
  getElementByIdOrNull('cancel-whitelist')?.addEventListener('click', closeWhitelistModal);
  getElementByIdOrNull('whitelist-form')?.addEventListener('submit', handleWhitelistSubmit);

  // Event delegation for list actions
  getElementByIdOrNull('groups-list')?.addEventListener('click', handleGroupsListClick);
  getElementByIdOrNull('filters-list')?.addEventListener('click', handleFiltersListClick);
  getElementByIdOrNull('filters-list')?.addEventListener('change', handleFiltersListClick);
  getElementByIdOrNull('whitelist-list')?.addEventListener('click', handleWhitelistListClick);
  getElementByIdOrNull('whitelist-list')?.addEventListener('change', handleWhitelistListClick);
  getElementByIdOrNull('schedules-list')?.addEventListener('click', handleSchedulesListClick);
  getElementByIdOrNull('schedules-list')?.addEventListener('change', handleSchedulesListClick);
}

// ============================================================================
// Rendering Functions
// ============================================================================

async function renderGroups(): Promise<void> {
  const data = await loadData();
  const groupsList = getElementByIdOrNull('groups-list');
  if (!groupsList) return;

  groupsList.innerHTML = data.groups
    .map((group) => {
      const filterCount = data.filters.filter((f) => f.groupId === group.id).length;
      const isDefault = group.id === DEFAULT_GROUP_ID;

      return `
        <div class="group-item">
          <div class="group-header">
            <div>
              <div class="filter-title">${escapeHtml(group.name)}</div>
              <div class="filter-meta">
                ${group.is24x7 ? 'Always Active' : `${group.schedules.length} schedule(s)`} • 
                ${filterCount} filter(s)
              </div>
            </div>
            <div class="actions">
              ${!isDefault ? `<button class="button small secondary" data-action="edit-group" data-group-id="${group.id}">Edit</button>` : ''}
              ${!isDefault ? `<button class="button small danger" data-action="delete-group" data-group-id="${group.id}">Delete</button>` : ''}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function renderFilters(): Promise<void> {
  const data = await loadData();
  const filtersList = getElementByIdOrNull('filters-list');
  if (!filtersList) return;

  if (data.filters.length === 0) {
    filtersList.innerHTML =
      '<p style="color: #a0aec0;">No filters configured. Click "Add Filter" to get started.</p>';
    return;
  }

  filtersList.innerHTML = data.filters
    .map((filter) => {
      const group = data.groups.find((g) => g.id === filter.groupId);
      const groupName = group?.name ?? 'Unknown Group';

      return `
        <div class="filter-item">
          <div class="filter-header">
            <div style="flex: 1;">
              <div class="filter-title">${filter.description ? escapeHtml(filter.description) : 'Unnamed Filter'}</div>
              <div class="filter-pattern">${escapeHtml(filter.pattern)}</div>
              <div class="filter-meta">Group: ${escapeHtml(groupName)}</div>
            </div>
            <div class="actions">
              <label class="toggle">
                <input type="checkbox" ${filter.enabled ? 'checked' : ''} data-action="toggle-filter" data-filter-id="${filter.id}">
                <span class="slider"></span>
              </label>
              <button class="button small secondary" data-action="edit-filter" data-filter-id="${filter.id}">Edit</button>
              <button class="button small danger" data-action="delete-filter" data-filter-id="${filter.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function renderWhitelist(): Promise<void> {
  const data = await loadData();
  const whitelistList = getElementByIdOrNull('whitelist-list');
  if (!whitelistList) return;

  if (data.whitelist.length === 0) {
    whitelistList.innerHTML =
      '<p style="color: #a0aec0;">No whitelist entries configured. Click "Add Whitelist Entry" to get started.</p>';
    return;
  }

  whitelistList.innerHTML = data.whitelist
    .map((entry) => {
      return `
        <div class="filter-item">
          <div class="filter-header">
            <div style="flex: 1;">
              <div class="filter-title">${entry.description ? escapeHtml(entry.description) : 'Unnamed Whitelist Entry'}</div>
              <div class="filter-pattern">${escapeHtml(entry.pattern)}</div>
            </div>
            <div class="actions">
              <label class="toggle">
                <input type="checkbox" ${entry.enabled ? 'checked' : ''} data-action="toggle-whitelist" data-whitelist-id="${entry.id}">
                <span class="slider"></span>
              </label>
              <button class="button small secondary" data-action="edit-whitelist" data-whitelist-id="${entry.id}">Edit</button>
              <button class="button small danger" data-action="delete-whitelist" data-whitelist-id="${entry.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSchedules(): void {
  const schedulesList = getElementByIdOrNull('schedules-list');
  if (!schedulesList) return;

  schedulesList.innerHTML = temporarySchedules
    .map((schedule, index) => {
      return `
        <div class="schedule-item">
          <div class="day-checkboxes">
            ${DAY_NAMES.map(
              (day, dayIndex) => `
              <label class="day-checkbox">
                <input type="checkbox" ${schedule.daysOfWeek.includes(dayIndex) ? 'checked' : ''} 
                  data-action="update-schedule-day" data-schedule-index="${index}" data-day="${dayIndex}">
                ${day}
              </label>
            `
            ).join('')}
          </div>
          <div class="time-inputs">
            <input type="time" value="${schedule.startTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="startTime" class="input">
            <span>to</span>
            <input type="time" value="${schedule.endTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="endTime" class="input">
            <button type="button" class="button small danger" data-action="remove-schedule" data-schedule-index="${index}">Remove</button>
          </div>
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// Filter Modal
// ============================================================================

function openFilterModal(filterId?: string): void {
  currentEditingFilterId = filterId ?? null;
  const modal = getElementByIdOrNull('filter-modal');
  const title = getElementByIdOrNull('filter-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('filter-form');

  if (!modal || !title || !form) return;

  form.reset();
  title.textContent = filterId ? 'Edit Filter' : 'Add Filter';

  loadData()
    .then((data) => {
      const groupSelect = getElementByIdOrNull<HTMLSelectElement>('filter-group');
      if (!groupSelect) return;

      groupSelect.innerHTML = data.groups
        .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
        .join('');

      if (filterId) {
        const filter = data.filters.find((f) => f.id === filterId);
        if (filter) {
          const patternInput = getElementByIdOrNull<HTMLInputElement>('filter-pattern');
          const descInput = getElementByIdOrNull<HTMLInputElement>('filter-description');
          const groupInput = getElementByIdOrNull<HTMLSelectElement>('filter-group');
          const enabledInput = getElementByIdOrNull<HTMLInputElement>('filter-enabled');
          const regexInput = getElementByIdOrNull<HTMLInputElement>('filter-is-regex');

          if (patternInput) patternInput.value = filter.pattern;
          if (descInput) descInput.value = filter.description ?? '';
          if (groupInput) groupInput.value = filter.groupId;
          if (enabledInput) enabledInput.checked = filter.enabled;
          if (regexInput) regexInput.checked = filter.isRegex ?? false;
        }
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to load data for filter modal:', error);
    });

  modal.classList.add('active');
}

function closeFilterModal(): void {
  getElementByIdOrNull('filter-modal')?.classList.remove('active');
  currentEditingFilterId = null;
}

async function handleFilterSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const pattern = getElementByIdOrNull<HTMLInputElement>('filter-pattern')?.value ?? '';
  const description = getElementByIdOrNull<HTMLInputElement>('filter-description')?.value ?? '';
  const groupId = getElementByIdOrNull<HTMLSelectElement>('filter-group')?.value ?? DEFAULT_GROUP_ID;
  const enabled = getElementByIdOrNull<HTMLInputElement>('filter-enabled')?.checked ?? true;
  const isRegex = getElementByIdOrNull<HTMLInputElement>('filter-is-regex')?.checked ?? false;

  // Validate regex if regex mode is enabled
  if (isRegex) {
    try {
      new RegExp(pattern);
    } catch (error) {
      alert(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  const filter: Filter = {
    id: currentEditingFilterId ?? generateId(),
    pattern,
    description,
    groupId,
    enabled,
    isRegex,
  };

  try {
    if (currentEditingFilterId) {
      await updateFilter(filter);
    } else {
      await addFilter(filter);
    }
    closeFilterModal();
    await renderFilters();
  } catch (error) {
    console.error('Failed to save filter:', error);
    alert('Failed to save filter. Please try again.');
  }
}

// ============================================================================
// Group Modal
// ============================================================================

function openGroupModal(groupId?: string): void {
  currentEditingGroupId = groupId ?? null;
  temporarySchedules = [];

  const modal = getElementByIdOrNull('group-modal');
  const title = getElementByIdOrNull('group-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('group-form');
  const schedulesContainer = getElementByIdOrNull('schedules-container');
  const is24x7Checkbox = getElementByIdOrNull<HTMLInputElement>('group-24x7');

  if (!modal || !title || !form || !schedulesContainer || !is24x7Checkbox) return;

  form.reset();
  title.textContent = groupId ? 'Edit Group' : 'Add Group';

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
          schedulesContainer.style.display = group.is24x7 ? 'none' : 'block';
          renderSchedules();
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load group data:', error);
      });
  } else {
    schedulesContainer.style.display = 'block';
    renderSchedules();
  }

  modal.classList.add('active');
}

function closeGroupModal(): void {
  getElementByIdOrNull('group-modal')?.classList.remove('active');
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

  const name = getElementByIdOrNull<HTMLInputElement>('group-name')?.value ?? '';
  const is24x7 = getElementByIdOrNull<HTMLInputElement>('group-24x7')?.checked ?? false;

  const group: FilterGroup = {
    id: currentEditingGroupId ?? generateId(),
    name,
    is24x7,
    schedules: is24x7 ? [] : temporarySchedules,
  };

  try {
    if (currentEditingGroupId) {
      await updateGroup(group);
    } else {
      await addGroup(group);
    }
    closeGroupModal();
    await renderGroups();
    await renderFilters();
  } catch (error) {
    console.error('Failed to save group:', error);
    alert('Failed to save group. Please try again.');
  }
}

// ============================================================================
// Whitelist Modal
// ============================================================================

function openWhitelistModal(whitelistId?: string): void {
  currentEditingWhitelistId = whitelistId ?? null;
  const modal = getElementByIdOrNull('whitelist-modal');
  const title = getElementByIdOrNull('whitelist-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('whitelist-form');

  if (!modal || !title || !form) return;

  form.reset();
  title.textContent = whitelistId ? 'Edit Whitelist Entry' : 'Add Whitelist Entry';

  if (whitelistId) {
    loadData()
      .then((data) => {
        const entry = data.whitelist.find((w) => w.id === whitelistId);
        if (entry) {
          const patternInput = getElementByIdOrNull<HTMLInputElement>('whitelist-pattern');
          const descInput = getElementByIdOrNull<HTMLInputElement>('whitelist-description');
          const enabledInput = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled');
          const regexInput = getElementByIdOrNull<HTMLInputElement>('whitelist-is-regex');

          if (patternInput) patternInput.value = entry.pattern;
          if (descInput) descInput.value = entry.description ?? '';
          if (enabledInput) enabledInput.checked = entry.enabled;
          if (regexInput) regexInput.checked = entry.isRegex ?? false;
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load whitelist data:', error);
      });
  }

  modal.classList.add('active');
}

function closeWhitelistModal(): void {
  getElementByIdOrNull('whitelist-modal')?.classList.remove('active');
  currentEditingWhitelistId = null;
}

async function handleWhitelistSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const pattern = getElementByIdOrNull<HTMLInputElement>('whitelist-pattern')?.value ?? '';
  const description = getElementByIdOrNull<HTMLInputElement>('whitelist-description')?.value ?? '';
  const enabled = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled')?.checked ?? true;
  const isRegex = getElementByIdOrNull<HTMLInputElement>('whitelist-is-regex')?.checked ?? false;

  // Validate regex if regex mode is enabled
  if (isRegex) {
    try {
      new RegExp(pattern);
    } catch (error) {
      alert(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  const entry: Whitelist = {
    id: currentEditingWhitelistId ?? generateId(),
    pattern,
    description,
    enabled,
    isRegex,
  };

  try {
    if (currentEditingWhitelistId) {
      await updateWhitelist(entry);
    } else {
      await addWhitelist(entry);
    }
    closeWhitelistModal();
    await renderWhitelist();
  } catch (error) {
    console.error('Failed to save whitelist entry:', error);
    alert('Failed to save whitelist entry. Please try again.');
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

  if (action === 'edit-group' && groupId) {
    openGroupModal(groupId);
  } else if (action === 'delete-group' && groupId) {
    deleteGroupConfirm(groupId);
  }
}

function handleFiltersListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement | null;
  const input = target.closest('input[data-action]') as HTMLInputElement | null;

  if (button) {
    const action = button.dataset['action'];
    const filterId = button.dataset['filterId'];

    if (action === 'edit-filter' && filterId) {
      openFilterModal(filterId);
    } else if (action === 'delete-filter' && filterId) {
      deleteFilterConfirm(filterId);
    }
  } else if (input?.dataset['action'] === 'toggle-filter') {
    const filterId = input.dataset['filterId'];
    if (filterId) {
      toggleFilter(filterId, input.checked);
    }
  }
}

function handleWhitelistListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement | null;
  const input = target.closest('input[data-action]') as HTMLInputElement | null;

  if (button) {
    const action = button.dataset['action'];
    const whitelistId = button.dataset['whitelistId'];

    if (action === 'edit-whitelist' && whitelistId) {
      openWhitelistModal(whitelistId);
    } else if (action === 'delete-whitelist' && whitelistId) {
      deleteWhitelistConfirm(whitelistId);
    }
  } else if (input?.dataset['action'] === 'toggle-whitelist') {
    const whitelistId = input.dataset['whitelistId'];
    if (whitelistId) {
      toggleWhitelistEntry(whitelistId, input.checked);
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

async function deleteFilterConfirm(filterId: string): Promise<void> {
  if (confirm('Are you sure you want to delete this filter?')) {
    await deleteFilter(filterId);
    await renderFilters();
  }
}

async function deleteGroupConfirm(groupId: string): Promise<void> {
  if (
    confirm(
      'Are you sure you want to delete this group? Filters in this group will be moved to the default 24/7 group.'
    )
  ) {
    await deleteGroup(groupId);
    await renderGroups();
    await renderFilters();
  }
}

async function toggleWhitelistEntry(whitelistId: string, enabled: boolean): Promise<void> {
  const data = await loadData();
  const entry = data.whitelist.find((w) => w.id === whitelistId);
  if (entry) {
    await updateWhitelist({ ...entry, enabled });
  }
}

async function deleteWhitelistConfirm(whitelistId: string): Promise<void> {
  if (confirm('Are you sure you want to delete this whitelist entry?')) {
    await deleteWhitelist(whitelistId);
    await renderWhitelist();
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

function removeSchedule(scheduleIndex: number): void {
  temporarySchedules.splice(scheduleIndex, 1);
  renderSchedules();
}

// Initialize on load
init().catch((error: unknown) => {
  console.error('Failed to initialize options page:', error);
});
