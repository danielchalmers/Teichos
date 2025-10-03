import { loadData, saveData, addFilter, updateFilter, deleteFilter, addGroup, updateGroup, deleteGroup } from './storage';
import { Filter, FilterGroup, TimeSchedule, generateId, DEFAULT_GROUP_ID } from './types';

let currentEditingFilterId: string | null = null;
let currentEditingGroupId: string | null = null;
let temporarySchedules: TimeSchedule[] = [];

async function init() {
  await renderGroups();
  await renderFilters();
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('add-filter-btn')!.addEventListener('click', () => {
    openFilterModal();
  });

  document.getElementById('add-group-btn')!.addEventListener('click', () => {
    openGroupModal();
  });

  document.getElementById('close-filter-modal')!.addEventListener('click', closeFilterModal);
  document.getElementById('cancel-filter')!.addEventListener('click', closeFilterModal);
  document.getElementById('close-group-modal')!.addEventListener('click', closeGroupModal);
  document.getElementById('cancel-group')!.addEventListener('click', closeGroupModal);

  document.getElementById('filter-form')!.addEventListener('submit', handleFilterSubmit);
  document.getElementById('group-form')!.addEventListener('submit', handleGroupSubmit);

  document.getElementById('group-24x7')!.addEventListener('change', (e) => {
    const is24x7 = (e.target as HTMLInputElement).checked;
    const schedulesContainer = document.getElementById('schedules-container')!;
    schedulesContainer.style.display = is24x7 ? 'none' : 'block';
  });

  document.getElementById('add-schedule-btn')!.addEventListener('click', addScheduleToModal);
}

async function renderGroups() {
  const data = await loadData();
  const groupsList = document.getElementById('groups-list')!;
  
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
            ${!isDefault ? `<button class="button small secondary" onclick="editGroup('${group.id}')">Edit</button>` : ''}
            ${!isDefault ? `<button class="button small danger" onclick="deleteGroupConfirm('${group.id}')">Delete</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function renderFilters() {
  const data = await loadData();
  const filtersList = document.getElementById('filters-list')!;
  
  if (data.filters.length === 0) {
    filtersList.innerHTML = '<p style="color: #a0aec0;">No filters configured. Click "Add Filter" to get started.</p>';
    return;
  }
  
  filtersList.innerHTML = data.filters.map(filter => {
    const group = data.groups.find(g => g.id === filter.groupId);
    const groupName = group ? group.name : 'Unknown Group';
    
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
              <input type="checkbox" ${filter.enabled ? 'checked' : ''} onchange="toggleFilter('${filter.id}', this.checked)">
              <span class="slider"></span>
            </label>
            <button class="button small secondary" onclick="editFilter('${filter.id}')">Edit</button>
            <button class="button small danger" onclick="deleteFilterConfirm('${filter.id}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openFilterModal(filterId?: string) {
  currentEditingFilterId = filterId || null;
  const modal = document.getElementById('filter-modal')!;
  const title = document.getElementById('filter-modal-title')!;
  const form = document.getElementById('filter-form') as HTMLFormElement;
  
  form.reset();
  title.textContent = filterId ? 'Edit Filter' : 'Add Filter';
  
  loadData().then(data => {
    const groupSelect = document.getElementById('filter-group') as HTMLSelectElement;
    groupSelect.innerHTML = data.groups.map(g => 
      `<option value="${g.id}">${escapeHtml(g.name)}</option>`
    ).join('');
    
    if (filterId) {
      const filter = data.filters.find(f => f.id === filterId);
      if (filter) {
        (document.getElementById('filter-pattern') as HTMLInputElement).value = filter.pattern;
        (document.getElementById('filter-description') as HTMLInputElement).value = filter.description || '';
        (document.getElementById('filter-group') as HTMLSelectElement).value = filter.groupId;
        (document.getElementById('filter-enabled') as HTMLInputElement).checked = filter.enabled;
      }
    }
  });
  
  modal.classList.add('active');
}

function closeFilterModal() {
  document.getElementById('filter-modal')!.classList.remove('active');
  currentEditingFilterId = null;
}

async function handleFilterSubmit(e: Event) {
  e.preventDefault();
  
  const pattern = (document.getElementById('filter-pattern') as HTMLInputElement).value;
  const description = (document.getElementById('filter-description') as HTMLInputElement).value;
  const groupId = (document.getElementById('filter-group') as HTMLSelectElement).value;
  const enabled = (document.getElementById('filter-enabled') as HTMLInputElement).checked;
  
  // Validate regex
  try {
    new RegExp(pattern);
  } catch (err) {
    alert('Invalid regex pattern: ' + (err as Error).message);
    return;
  }
  
  const filter: Filter = {
    id: currentEditingFilterId || generateId(),
    pattern,
    description,
    groupId,
    enabled,
  };
  
  if (currentEditingFilterId) {
    await updateFilter(filter);
  } else {
    await addFilter(filter);
  }
  
  closeFilterModal();
  await renderFilters();
}

function openGroupModal(groupId?: string) {
  currentEditingGroupId = groupId || null;
  temporarySchedules = [];
  
  const modal = document.getElementById('group-modal')!;
  const title = document.getElementById('group-modal-title')!;
  const form = document.getElementById('group-form') as HTMLFormElement;
  
  form.reset();
  title.textContent = groupId ? 'Edit Group' : 'Add Group';
  
  document.getElementById('schedules-container')!.style.display = 'none';
  
  if (groupId && groupId !== DEFAULT_GROUP_ID) {
    loadData().then(data => {
      const group = data.groups.find(g => g.id === groupId);
      if (group) {
        (document.getElementById('group-name') as HTMLInputElement).value = group.name;
        (document.getElementById('group-24x7') as HTMLInputElement).checked = group.is24x7;
        
        if (!group.is24x7) {
          temporarySchedules = [...group.schedules];
          document.getElementById('schedules-container')!.style.display = 'block';
          renderSchedules();
        }
      }
    });
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
              onchange="updateScheduleDay(${index}, ${dayIndex}, this.checked)">
            ${day}
          </label>
        `).join('')}
      </div>
      <div class="time-inputs">
        <input type="time" value="${schedule.startTime}" onchange="updateScheduleTime(${index}, 'startTime', this.value)" class="input">
        <span>to</span>
        <input type="time" value="${schedule.endTime}" onchange="updateScheduleTime(${index}, 'endTime', this.value)" class="input">
        <button type="button" class="button small danger" onclick="removeSchedule(${index})">Remove</button>
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

// Global functions for inline event handlers
(window as any).toggleFilter = async (filterId: string, enabled: boolean) => {
  const data = await loadData();
  const filter = data.filters.find(f => f.id === filterId);
  if (filter) {
    filter.enabled = enabled;
    await updateFilter(filter);
  }
};

(window as any).editFilter = (filterId: string) => {
  openFilterModal(filterId);
};

(window as any).deleteFilterConfirm = async (filterId: string) => {
  if (confirm('Are you sure you want to delete this filter?')) {
    await deleteFilter(filterId);
    await renderFilters();
  }
};

(window as any).editGroup = (groupId: string) => {
  openGroupModal(groupId);
};

(window as any).deleteGroupConfirm = async (groupId: string) => {
  if (confirm('Are you sure you want to delete this group? Filters in this group will be moved to the default 24/7 group.')) {
    await deleteGroup(groupId);
    await renderGroups();
    await renderFilters();
  }
};

(window as any).updateScheduleDay = (scheduleIndex: number, day: number, checked: boolean) => {
  if (checked) {
    if (!temporarySchedules[scheduleIndex].daysOfWeek.includes(day)) {
      temporarySchedules[scheduleIndex].daysOfWeek.push(day);
      temporarySchedules[scheduleIndex].daysOfWeek.sort((a, b) => a - b);
    }
  } else {
    temporarySchedules[scheduleIndex].daysOfWeek = 
      temporarySchedules[scheduleIndex].daysOfWeek.filter(d => d !== day);
  }
};

(window as any).updateScheduleTime = (scheduleIndex: number, field: 'startTime' | 'endTime', value: string) => {
  temporarySchedules[scheduleIndex][field] = value;
};

(window as any).removeSchedule = (scheduleIndex: number) => {
  temporarySchedules.splice(scheduleIndex, 1);
  renderSchedules();
};

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();
