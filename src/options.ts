import { loadData, saveData, addFilter, updateFilter, deleteFilter, addGroup, updateGroup, deleteGroup, addWhitelist, updateWhitelist, deleteWhitelist } from './storage';
import { Filter, FilterGroup, Whitelist, TimeSchedule, generateId, DEFAULT_GROUP_ID } from './types';

// Mutable version of TimeSchedule for internal use
interface MutableTimeSchedule {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

let currentEditingFilterId: string | null = null;
let currentEditingGroupId: string | null = null;
let currentEditingWhitelistId: string | null = null;
let temporarySchedules: MutableTimeSchedule[] = [];

async function init(): Promise<void> {
  await renderGroups();
  await renderFilters();
  await renderWhitelist();
  setupEventListeners();
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setupEventListeners(): void {
  getElement('add-filter-btn')?.addEventListener('click', () => {
    openFilterModal();
  });

  getElement('add-group-btn')?.addEventListener('click', () => {
    openGroupModal();
  });

  getElement('add-whitelist-btn')?.addEventListener('click', () => {
    openWhitelistModal();
  });

  getElement('close-filter-modal')?.addEventListener('click', closeFilterModal);
  getElement('cancel-filter')?.addEventListener('click', closeFilterModal);
  getElement('close-group-modal')?.addEventListener('click', closeGroupModal);
  getElement('cancel-group')?.addEventListener('click', closeGroupModal);
  getElement('close-whitelist-modal')?.addEventListener('click', closeWhitelistModal);
  getElement('cancel-whitelist')?.addEventListener('click', closeWhitelistModal);

  getElement('filter-form')?.addEventListener('submit', handleFilterSubmit);
  getElement('group-form')?.addEventListener('submit', handleGroupSubmit);
  getElement('whitelist-form')?.addEventListener('submit', handleWhitelistSubmit);

  getElement('group-24x7')?.addEventListener('change', (e) => {
    const is24x7 = (e.target as HTMLInputElement).checked;
    const schedulesContainer = getElement('schedules-container');
    if (schedulesContainer) {
      schedulesContainer.style.display = is24x7 ? 'none' : 'block';
    }
  });

  getElement('add-schedule-btn')?.addEventListener('click', addScheduleToModal);

  // Event delegation for list item buttons
  getElement('groups-list')?.addEventListener('click', handleGroupsListClick);
  getElement('filters-list')?.addEventListener('click', handleFiltersListClick);
  getElement('filters-list')?.addEventListener('change', handleFiltersListClick);
  getElement('whitelist-list')?.addEventListener('click', handleWhitelistListClick);
  getElement('whitelist-list')?.addEventListener('change', handleWhitelistListClick);
  getElement('schedules-list')?.addEventListener('click', handleSchedulesListClick);
  getElement('schedules-list')?.addEventListener('change', handleSchedulesListClick);
}

async function renderGroups(): Promise<void> {
  const data = await loadData();
  const groupsList = getElement('groups-list');
  
  if (!groupsList) return;
  
  groupsList.innerHTML = data.groups.map(group => {
    const filterCount = data.filters.filter(f => f.groupId === group.id).length;
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
  }).join('');
}

async function renderFilters(): Promise<void> {
  const data = await loadData();
  const filtersList = getElement('filters-list');
  
  if (!filtersList) return;
  
  if (data.filters.length === 0) {
    filtersList.innerHTML = '<p style="color: #a0aec0;">No filters configured. Click "Add Filter" to get started.</p>';
    return;
  }
  
  filtersList.innerHTML = data.filters.map(filter => {
    const group = data.groups.find(g => g.id === filter.groupId);
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
  }).join('');
}

function openFilterModal(filterId?: string): void {
  currentEditingFilterId = filterId ?? null;
  const modal = getElement('filter-modal');
  const title = getElement('filter-modal-title');
  const form = getElement<HTMLFormElement>('filter-form');
  
  if (!modal || !title || !form) return;
  
  form.reset();
  title.textContent = filterId ? 'Edit Filter' : 'Add Filter';
  
  loadData().then(data => {
    const groupSelect = getElement<HTMLSelectElement>('filter-group');
    if (!groupSelect) return;
    
    groupSelect.innerHTML = data.groups.map(g => 
      `<option value="${g.id}">${escapeHtml(g.name)}</option>`
    ).join('');
    
    if (filterId) {
      const filter = data.filters.find(f => f.id === filterId);
      if (filter) {
        const patternInput = getElement<HTMLInputElement>('filter-pattern');
        const descInput = getElement<HTMLInputElement>('filter-description');
        const groupInput = getElement<HTMLSelectElement>('filter-group');
        const enabledInput = getElement<HTMLInputElement>('filter-enabled');
        const regexInput = getElement<HTMLInputElement>('filter-is-regex');
        
        if (patternInput) patternInput.value = filter.pattern;
        if (descInput) descInput.value = filter.description ?? '';
        if (groupInput) groupInput.value = filter.groupId;
        if (enabledInput) enabledInput.checked = filter.enabled;
        if (regexInput) regexInput.checked = filter.isRegex ?? false;
      }
    }
  }).catch(error => {
    console.error('Failed to load data for filter modal:', error);
  });
  
  modal.classList.add('active');
}

function closeFilterModal(): void {
  const modal = getElement('filter-modal');
  modal?.classList.remove('active');
  currentEditingFilterId = null;
}

async function handleFilterSubmit(e: Event) {
  e.preventDefault();
  
  const pattern = (document.getElementById('filter-pattern') as HTMLInputElement).value;
  const description = (document.getElementById('filter-description') as HTMLInputElement).value;
  const groupId = (document.getElementById('filter-group') as HTMLSelectElement).value;
  const enabled = (document.getElementById('filter-enabled') as HTMLInputElement).checked;
  const isRegex = (getElement<HTMLInputElement>('filter-is-regex'))?.checked ?? false;
  
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

function openGroupModal(groupId?: string) {
  currentEditingGroupId = groupId || null;
  temporarySchedules = [];
  
  const modal = document.getElementById('group-modal')!;
  const title = document.getElementById('group-modal-title')!;
  const form = document.getElementById('group-form') as HTMLFormElement;
  const schedulesContainer = document.getElementById('schedules-container')!;
  const is24x7Checkbox = document.getElementById('group-24x7') as HTMLInputElement;
  
  form.reset();
  title.textContent = groupId ? 'Edit Group' : 'Add Group';
  
  if (groupId && groupId !== DEFAULT_GROUP_ID) {
    loadData().then(data => {
      const group = data.groups.find(g => g.id === groupId);
      if (group) {
        (document.getElementById('group-name') as HTMLInputElement).value = group.name;
        is24x7Checkbox.checked = group.is24x7;
        // Create mutable copies of the schedules
        temporarySchedules = group.schedules.map(schedule => ({
          daysOfWeek: [...schedule.daysOfWeek],
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        }));
        
        // Show/hide schedules based on is24x7
        schedulesContainer.style.display = group.is24x7 ? 'none' : 'block';
        renderSchedules();
      }
    });
  } else {
    // New group: checkbox is unchecked by default, so show schedules container
    schedulesContainer.style.display = 'block';
    renderSchedules();
  }
  
  modal.classList.add('active');
}

function closeGroupModal() {
  document.getElementById('group-modal')!.classList.remove('active');
  currentEditingGroupId = null;
  temporarySchedules = [];
}

function addScheduleToModal() {
  temporarySchedules.push({
    daysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
    startTime: '09:00',
    endTime: '17:00',
  });
  renderSchedules();
}

function renderSchedules() {
  const schedulesList = document.getElementById('schedules-list')!;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  schedulesList.innerHTML = temporarySchedules.map((schedule, index) => `
    <div class="schedule-item">
      <div class="day-checkboxes">
        ${dayNames.map((day, dayIndex) => `
          <label class="day-checkbox">
            <input type="checkbox" ${schedule.daysOfWeek.includes(dayIndex) ? 'checked' : ''} 
              data-action="update-schedule-day" data-schedule-index="${index}" data-day="${dayIndex}">
            ${day}
          </label>
        `).join('')}
      </div>
      <div class="time-inputs">
        <input type="time" value="${schedule.startTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="startTime" class="input">
        <span>to</span>
        <input type="time" value="${schedule.endTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="endTime" class="input">
        <button type="button" class="button small danger" data-action="remove-schedule" data-schedule-index="${index}">Remove</button>
      </div>
    </div>
  `).join('');
}

async function handleGroupSubmit(e: Event) {
  e.preventDefault();
  
  const name = (document.getElementById('group-name') as HTMLInputElement).value;
  const is24x7 = (document.getElementById('group-24x7') as HTMLInputElement).checked;
  
  const group: FilterGroup = {
    id: currentEditingGroupId || generateId(),
    name,
    is24x7,
    schedules: is24x7 ? [] : temporarySchedules,
  };
  
  if (currentEditingGroupId) {
    await updateGroup(group);
  } else {
    await addGroup(group);
  }
  
  closeGroupModal();
  await renderGroups();
  await renderFilters(); // Re-render to update group names
}

async function renderWhitelist(): Promise<void> {
  const data = await loadData();
  const whitelistList = getElement('whitelist-list');
  
  if (!whitelistList) return;
  
  if (data.whitelist.length === 0) {
    whitelistList.innerHTML = '<p style="color: #a0aec0;">No whitelist entries configured. Click "Add Whitelist Entry" to get started.</p>';
    return;
  }
  
  whitelistList.innerHTML = data.whitelist.map(whitelist => {
    return `
      <div class="filter-item">
        <div class="filter-header">
          <div style="flex: 1;">
            <div class="filter-title">${whitelist.description ? escapeHtml(whitelist.description) : 'Unnamed Whitelist Entry'}</div>
            <div class="filter-pattern">${escapeHtml(whitelist.pattern)}</div>
          </div>
          <div class="actions">
            <label class="toggle">
              <input type="checkbox" ${whitelist.enabled ? 'checked' : ''} data-action="toggle-whitelist" data-whitelist-id="${whitelist.id}">
              <span class="slider"></span>
            </label>
            <button class="button small secondary" data-action="edit-whitelist" data-whitelist-id="${whitelist.id}">Edit</button>
            <button class="button small danger" data-action="delete-whitelist" data-whitelist-id="${whitelist.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openWhitelistModal(whitelistId?: string) {
  currentEditingWhitelistId = whitelistId || null;
  const modal = document.getElementById('whitelist-modal')!;
  const title = document.getElementById('whitelist-modal-title')!;
  const form = document.getElementById('whitelist-form') as HTMLFormElement;
  
  form.reset();
  title.textContent = whitelistId ? 'Edit Whitelist Entry' : 'Add Whitelist Entry';
  
  if (whitelistId) {
    loadData().then(data => {
      const whitelist = data.whitelist.find(w => w.id === whitelistId);
      if (whitelist) {
        (document.getElementById('whitelist-pattern') as HTMLInputElement).value = whitelist.pattern;
        (document.getElementById('whitelist-description') as HTMLInputElement).value = whitelist.description || '';
        (document.getElementById('whitelist-enabled') as HTMLInputElement).checked = whitelist.enabled;
        (document.getElementById('whitelist-is-regex') as HTMLInputElement).checked = whitelist.isRegex || false;
      }
    });
  }
  
  modal.classList.add('active');
}

function closeWhitelistModal() {
  document.getElementById('whitelist-modal')!.classList.remove('active');
  currentEditingWhitelistId = null;
}

async function handleWhitelistSubmit(e: Event) {
  e.preventDefault();
  
  const pattern = (document.getElementById('whitelist-pattern') as HTMLInputElement).value;
  const description = (document.getElementById('whitelist-description') as HTMLInputElement).value;
  const enabled = (document.getElementById('whitelist-enabled') as HTMLInputElement).checked;
  const isRegex = (document.getElementById('whitelist-is-regex') as HTMLInputElement).checked;
  
  // Validate regex if regex mode is enabled
  if (isRegex) {
    try {
      new RegExp(pattern);
    } catch (err) {
      alert('Invalid regex pattern: ' + (err as Error).message);
      return;
    }
  }
  
  const whitelist: Whitelist = {
    id: currentEditingWhitelistId || generateId(),
    pattern,
    description,
    enabled,
    isRegex,
  };
  
  if (currentEditingWhitelistId) {
    await updateWhitelist(whitelist);
  } else {
    await addWhitelist(whitelist);
  }
  
  closeWhitelistModal();
  await renderWhitelist();
}

function handleGroupsListClick(e: Event) {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement;
  
  if (!button) return;
  
  const action = button.dataset['action'];
  const groupId = button.dataset['groupId'];
  
  if (action === 'edit-group' && groupId) {
    openGroupModal(groupId);
  } else if (action === 'delete-group' && groupId) {
    deleteGroupConfirm(groupId);
  }
}

function handleFiltersListClick(e: Event) {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement;
  const input = target.closest('input[data-action]') as HTMLInputElement;
  
  if (button) {
    const action = button.dataset['action'];
    const filterId = button.dataset['filterId'];
    
    if (action === 'edit-filter' && filterId) {
      openFilterModal(filterId);
    } else if (action === 'delete-filter' && filterId) {
      deleteFilterConfirm(filterId);
    }
  } else if (input && input.dataset['action'] === 'toggle-filter') {
    const filterId = input.dataset['filterId'];
    if (filterId) {
      toggleFilter(filterId, input.checked);
    }
  }
}

function handleWhitelistListClick(e: Event) {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement;
  const input = target.closest('input[data-action]') as HTMLInputElement;
  
  if (button) {
    const action = button.dataset['action'];
    const whitelistId = button.dataset['whitelistId'];
    
    if (action === 'edit-whitelist' && whitelistId) {
      openWhitelistModal(whitelistId);
    } else if (action === 'delete-whitelist' && whitelistId) {
      deleteWhitelistConfirm(whitelistId);
    }
  } else if (input && input.dataset['action'] === 'toggle-whitelist') {
    const whitelistId = input.dataset['whitelistId'];
    if (whitelistId) {
      toggleWhitelist(whitelistId, input.checked);
    }
  }
}

function handleSchedulesListClick(e: Event) {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement;
  const input = target.closest('input[data-action]') as HTMLInputElement;
  
  if (button && button.dataset['action'] === 'remove-schedule') {
    const scheduleIndex = parseInt(button.dataset['scheduleIndex'] || '', 10);
    if (!isNaN(scheduleIndex)) {
      removeSchedule(scheduleIndex);
    }
  } else if (input) {
    const action = input.dataset['action'];
    const scheduleIndex = parseInt(input.dataset['scheduleIndex'] || '', 10);
    
    if (isNaN(scheduleIndex)) return;
    
    if (action === 'update-schedule-day') {
      const day = parseInt(input.dataset['day'] || '', 10);
      if (!isNaN(day)) {
        updateScheduleDay(scheduleIndex, day, input.checked);
      }
    } else if (action === 'update-schedule-time') {
      const field = input.dataset['field'] as 'startTime' | 'endTime' | undefined;
      if (field) {
        updateScheduleTime(scheduleIndex, field, input.value);
      }
    }
  }
}

async function toggleFilter(filterId: string, enabled: boolean) {
  const data = await loadData();
  const filter = data.filters.find(f => f.id === filterId);
  if (filter) {
    const updatedFilter = { ...filter, enabled };
    await updateFilter(updatedFilter);
  }
}

async function deleteFilterConfirm(filterId: string) {
  if (confirm('Are you sure you want to delete this filter?')) {
    await deleteFilter(filterId);
    await renderFilters();
  }
}

async function deleteGroupConfirm(groupId: string) {
  if (confirm('Are you sure you want to delete this group? Filters in this group will be moved to the default 24/7 group.')) {
    await deleteGroup(groupId);
    await renderGroups();
    await renderFilters();
  }
}

function updateScheduleDay(scheduleIndex: number, day: number, checked: boolean) {
  const schedule = temporarySchedules[scheduleIndex];
  if (!schedule) return;
  
  if (checked) {
    if (!schedule.daysOfWeek.includes(day)) {
      schedule.daysOfWeek.push(day);
      schedule.daysOfWeek.sort((a: number, b: number) => a - b);
    }
  } else {
    schedule.daysOfWeek = schedule.daysOfWeek.filter(d => d !== day);
  }
}

function updateScheduleTime(scheduleIndex: number, field: 'startTime' | 'endTime', value: string) {
  const schedule = temporarySchedules[scheduleIndex];
  if (!schedule) return;
  
  schedule[field] = value;
}

function removeSchedule(scheduleIndex: number) {
  temporarySchedules.splice(scheduleIndex, 1);
  renderSchedules();
}

async function toggleWhitelist(whitelistId: string, enabled: boolean) {
  const data = await loadData();
  const whitelist = data.whitelist.find(w => w.id === whitelistId);
  if (whitelist) {
    const updatedWhitelist = { ...whitelist, enabled };
    await updateWhitelist(updatedWhitelist);
  }
}

async function deleteWhitelistConfirm(whitelistId: string) {
  if (confirm('Are you sure you want to delete this whitelist entry?')) {
    await deleteWhitelist(whitelistId);
    await renderWhitelist();
  }
}


function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init().catch(error => {
  console.error('Failed to initialize options page:', error);
});
