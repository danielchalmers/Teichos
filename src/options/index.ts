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
  Filter,
  FilterGroup,
  FilterMatchMode,
  Whitelist,
  MutableTimeSchedule,
} from '../shared/types';
import { DEFAULT_GROUP_ID, isCloseInfoPanelMessage, STORAGE_KEY } from '../shared/types';
import {
  formatDuration,
  generateId,
  getRegexValidationError,
  getTemporaryFilterRemainingMs,
} from '../shared/utils';
import { cloneTemplate, getElementByIdOrNull, querySelector } from '../shared/utils/dom';
import { DAY_NAMES, DEFAULT_SCHEDULE } from '../shared/constants';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal state
let currentEditingFilterId: string | null = null;
let currentEditingGroupId: string | null = null;
let currentEditingWhitelistId: string | null = null;
let currentFilterGroupId: string | null = null;
let currentWhitelistGroupId: string | null = null;
let temporarySchedules: MutableTimeSchedule[] = [];
let activeModal: HTMLElement | null = null;
let lastFocusedElement: HTMLElement | null = null;
let setInfoPopoverOpen: ((isOpen: boolean) => void) | null = null;

/**
 * Initialize options page
 */
async function init(): Promise<void> {
  await renderGroups();
  setupEventListeners();
  setupStorageSync();
  populateInfoPanel();
  openFilterFromQuery();
  openInfoFromQuery();
}

/**
 * Set up all event listeners
 */
function setupEventListeners(): void {
  setInfoPopoverOpen = setupInfoPopover();

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }

    if (isCloseInfoPanelMessage(message)) {
      setInfoPopoverOpen?.(false);
    }
  });

  // Add buttons
  getElementByIdOrNull('add-group-btn')?.addEventListener('click', () =>
    openGroupModal()
  );

  // Filter modal
  getElementByIdOrNull('close-filter-modal')?.addEventListener('click', closeFilterModal);
  getElementByIdOrNull('cancel-filter')?.addEventListener('click', closeFilterModal);
  getElementByIdOrNull('filter-form')?.addEventListener('submit', handleFilterSubmit);
  getElementByIdOrNull('delete-filter')?.addEventListener('click', handleFilterDelete);

  // Group modal
  getElementByIdOrNull('close-group-modal')?.addEventListener('click', closeGroupModal);
  getElementByIdOrNull('cancel-group')?.addEventListener('click', closeGroupModal);
  getElementByIdOrNull('group-form')?.addEventListener('submit', handleGroupSubmit);
  getElementByIdOrNull('delete-group')?.addEventListener('click', handleGroupDelete);
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
  getElementByIdOrNull('delete-whitelist')?.addEventListener('click', handleWhitelistDelete);

  // Event delegation for list actions
  const groupsList = getElementByIdOrNull('groups-list');
  groupsList?.addEventListener('click', handleGroupsListClick);
  groupsList?.addEventListener('change', handleGroupsListChange);
  getElementByIdOrNull('schedules-list')?.addEventListener('click', handleSchedulesListClick);
  getElementByIdOrNull('schedules-list')?.addEventListener('change', handleSchedulesListClick);

  document.addEventListener('keydown', handleGlobalKeydown);
}

function setupStorageSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes[STORAGE_KEY]) return;
    void renderGroups().catch((error: unknown) => {
      console.error('Failed to refresh groups:', error);
    });
  });
}

function setupInfoPopover(): ((isOpen: boolean) => void) | null {
  const popover = document.querySelector<HTMLElement>('.info-popover');
  if (!popover) return null;

  const button = popover.querySelector<HTMLButtonElement>('.info-button');
  const panel = popover.querySelector<HTMLElement>('.info-panel');
  if (!button || !panel) return null;

  const setOpen = (isOpen: boolean, returnFocus = false): void => {
    popover.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) {
      panel.removeAttribute('inert');
    } else {
      panel.setAttribute('inert', '');
      if (returnFocus) {
        button.focus();
      }
    }
  };

  setOpen(popover.classList.contains('is-open'));

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
    if (event.key === 'Escape' && popover.classList.contains('is-open')) {
      const shouldReturnFocus = popover.contains(document.activeElement);
      setOpen(false, shouldReturnFocus);
    }
  });

  return setOpen;
}

function openFilterFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  const filterId = params.get('editFilter');
  const modal = params.get('modal');
  let handled = false;

  if (filterId) {
    openFilterModal(filterId);
    handled = true;
  } else if (modal === 'filter') {
    openFilterModal();
    handled = true;
  } else if (modal === 'whitelist') {
    openWhitelistModal();
    handled = true;
  } else if (modal === 'group') {
    openGroupModal();
    handled = true;
  }

  if (!handled) return;

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('editFilter');
  nextUrl.searchParams.delete('modal');
  history.replaceState({}, document.title, nextUrl.toString());
}

function openInfoFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('info')) return;

  setInfoPopoverOpen?.(true);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('info');
  history.replaceState({}, document.title, nextUrl.toString());
}

function populateInfoPanel(): void {
  const manifest = chrome.runtime.getManifest();
  const versionElement = getElementByIdOrNull('info-version');
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  const year = new Date().getFullYear();
  const copyrightElement = getElementByIdOrNull('info-copyright');
  if (copyrightElement) {
    copyrightElement.textContent = `(c) ${year} Daniel Chalmers`;
  }
}

// ============================================================================
// Accessibility Helpers
// ============================================================================

function setMainInert(isInert: boolean): void {
  const container = document.querySelector<HTMLElement>('.container');
  if (!container) return;

  if (isInert) {
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('inert', '');
  } else {
    container.removeAttribute('aria-hidden');
    container.removeAttribute('inert');
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function focusModal(modal: HTMLElement, preferredSelector?: string): void {
  if (preferredSelector) {
    const preferredElement = modal.querySelector<HTMLElement>(preferredSelector);
    if (preferredElement) {
      preferredElement.focus();
      return;
    }
  }

  const focusableElements = getFocusableElements(modal);
  if (focusableElements.length > 0) {
    focusableElements[0].focus();
    return;
  }

  const fallback = modal.querySelector<HTMLElement>('.modal-content');
  fallback?.focus();
}

function getFocusRestoreSelector(element: HTMLElement): string | null {
  const action = element.getAttribute('data-action');
  if (!action) return null;

  const filterId = element.getAttribute('data-filter-id');
  if (filterId) {
    return `[data-action="${action}"][data-filter-id="${filterId}"]`;
  }

  const whitelistId = element.getAttribute('data-whitelist-id');
  if (whitelistId) {
    return `[data-action="${action}"][data-whitelist-id="${whitelistId}"]`;
  }

  const groupId = element.getAttribute('data-group-id');
  if (groupId) {
    return `[data-action="${action}"][data-group-id="${groupId}"]`;
  }

  return `[data-action="${action}"]`;
}

function trapFocus(event: KeyboardEvent, modal: HTMLElement): void {
  const focusableElements = getFocusableElements(modal);
  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (!active || !modal.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function activateModal(modal: HTMLElement, preferredSelector?: string): void {
  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeModal = modal;
  modal.setAttribute('aria-hidden', 'false');
  setMainInert(true);
  window.requestAnimationFrame(() => {
    focusModal(modal, preferredSelector);
  });
}

function deactivateModal(modal: HTMLElement): void {
  if (activeModal !== modal) return;
  modal.setAttribute('aria-hidden', 'true');
  setMainInert(false);
  activeModal = null;
  if (lastFocusedElement) {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

// ============================================================================
// Rendering Functions
// ============================================================================

async function renderGroups(): Promise<void> {
  const data = await loadData();
  const groupsList = getElementByIdOrNull('groups-list');
  if (!groupsList) return;

  const focusTarget = document.activeElement as HTMLElement | null;
  const focusSelector =
    focusTarget && groupsList.contains(focusTarget)
      ? getFocusRestoreSelector(focusTarget)
      : null;

  const hadGroups = groupsList.children.length > 0;
  const openGroupIds = new Set(
    Array.from(
      groupsList.querySelectorAll<HTMLDetailsElement>('details.group-item[open]')
    )
      .map((details) => details.dataset['groupId'])
      .filter((groupId): groupId is string => Boolean(groupId))
  );

  const filtersByGroup = new Map<string, Filter[]>();
  for (const filter of data.filters) {
    const groupFilters = filtersByGroup.get(filter.groupId);
    if (groupFilters) {
      groupFilters.push(filter);
    } else {
      filtersByGroup.set(filter.groupId, [filter]);
    }
  }

  const whitelistByGroup = new Map<string, Whitelist[]>();
  for (const entry of data.whitelist) {
    const groupEntries = whitelistByGroup.get(entry.groupId);
    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      whitelistByGroup.set(entry.groupId, [entry]);
    }
  }
  const fragment = document.createDocumentFragment();
  for (const group of data.groups) {
    const filters = filtersByGroup.get(group.id) ?? [];
    const whitelist = whitelistByGroup.get(group.id) ?? [];
    fragment.appendChild(renderGroup(group, filters, whitelist));
  }

  groupsList.replaceChildren(fragment);

  if (openGroupIds.size > 0) {
    openGroupIds.forEach((groupId) => {
      const details = groupsList.querySelector<HTMLDetailsElement>(
        `details.group-item[data-group-id="${groupId}"]`
      );
      if (details) {
        details.open = true;
      }
    });
  } else if (!hadGroups) {
    const firstGroup = groupsList.querySelector<HTMLDetailsElement>('details.group-item');
    if (firstGroup) {
      firstGroup.open = true;
    }
  }

  if (focusSelector) {
    const restored = groupsList.querySelector<HTMLElement>(focusSelector);
    restored?.focus();
  }
}

function renderGroup(
  group: FilterGroup,
  filters: readonly Filter[],
  whitelist: readonly Whitelist[]
): HTMLDetailsElement {
  const isDefault = group.id === DEFAULT_GROUP_ID;
  const scheduleSummary = group.is24x7
    ? 'Always Active'
    : pluralize(group.schedules.length, 'schedule');
  const filterSummary = pluralize(filters.length, 'filter');
  const exceptionSummary = pluralize(whitelist.length, 'exception', 'exceptions');

  const groupElement = cloneTemplate<HTMLDetailsElement>('options-group-template');
  groupElement.dataset.groupId = group.id;

  querySelector<HTMLElement>('[data-role="group-title"]', groupElement).textContent =
    group.name;
  querySelector<HTMLElement>('[data-role="group-meta"]', groupElement).textContent =
    `${scheduleSummary} • ${filterSummary} • ${exceptionSummary}`;

  const actions = querySelector<HTMLElement>('[data-role="group-actions"]', groupElement);
  if (!isDefault) {
    const editButton = cloneTemplate<HTMLButtonElement>('options-group-edit-button-template');
    editButton.dataset.groupId = group.id;
    actions.appendChild(editButton);
  }

  const filterList = querySelector<HTMLElement>('[data-role="filter-list"]', groupElement);
  const whitelistList = querySelector<HTMLElement>('[data-role="whitelist-list"]', groupElement);
  const addFilterButton = querySelector<HTMLButtonElement>(
    'button[data-action="add-filter"]',
    groupElement
  );
  const addWhitelistButton = querySelector<HTMLButtonElement>(
    'button[data-action="add-whitelist"]',
    groupElement
  );

  addFilterButton.dataset.groupId = group.id;
  addWhitelistButton.dataset.groupId = group.id;

  if (filters.length === 0) {
    filterList.appendChild(createEmptyState('No filters in this group.'));
  } else {
    const filterFragment = document.createDocumentFragment();
    for (const filter of filters) {
      filterFragment.appendChild(renderFilterItem(filter));
    }
    filterList.appendChild(filterFragment);
  }

  if (whitelist.length === 0) {
    whitelistList.appendChild(createEmptyState('No exceptions in this group.'));
  } else {
    const whitelistFragment = document.createDocumentFragment();
    for (const entry of whitelist) {
      whitelistFragment.appendChild(renderWhitelistItem(entry));
    }
    whitelistList.appendChild(whitelistFragment);
  }

  return groupElement;
}

function createEmptyState(message: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = 'empty-state';
  element.textContent = message;
  return element;
}

function getMatchModeSelectValue(selectId: string): FilterMatchMode {
  const value = getElementByIdOrNull<HTMLSelectElement>(selectId)?.value;
  if (value === 'contains' || value === 'exact' || value === 'regex') {
    return value;
  }
  return 'contains';
}

function ensureValidRegex(pattern: string, matchMode: FilterMatchMode): boolean {
  if (matchMode !== 'regex') {
    return true;
  }

  const error = getRegexValidationError(pattern);
  if (!error) {
    return true;
  }

  alert(`Invalid regex pattern: ${error}`);
  return false;
}

function renderFilterItem(filter: Filter): HTMLElement {
  const description = filter.description?.trim();
  const toggleLabel = description
    ? `Toggle filter ${description}`
    : `Toggle filter for ${filter.pattern}`;

  const item = cloneTemplate<HTMLDivElement>('options-filter-item-template');
  const titleElement = querySelector<HTMLElement>('[data-role="filter-title"]', item);
  const patternElement = querySelector<HTMLElement>('[data-role="filter-pattern"]', item);
  const metaElement = item.querySelector<HTMLElement>('[data-role="filter-meta"]');
  const toggleInput = querySelector<HTMLInputElement>(
    'input[data-action="toggle-filter"]',
    item
  );
  const editButton = querySelector<HTMLButtonElement>(
    'button[data-action="edit-filter"]',
    item
  );

  if (description) {
    titleElement.textContent = description;
  } else {
    titleElement.remove();
  }

  patternElement.textContent = filter.pattern;
  const remainingMs = getTemporaryFilterRemainingMs(filter);
  if (metaElement) {
    if (remainingMs === null) {
      metaElement.remove();
    } else if (remainingMs <= 0) {
      metaElement.textContent = 'Temporary (expired)';
      metaElement.classList.add('is-temporary', 'is-expired');
    } else {
      metaElement.textContent = `Temporary (${formatDuration(remainingMs)} left)`;
      metaElement.classList.add('is-temporary');
    }
  }
  toggleInput.checked = filter.enabled;
  toggleInput.dataset.filterId = filter.id;
  toggleInput.setAttribute('aria-label', toggleLabel);
  editButton.dataset.filterId = filter.id;

  return item;
}

function renderWhitelistItem(entry: Whitelist): HTMLElement {
  const description = entry.description?.trim();
  const toggleLabel = description
    ? `Toggle exception ${description}`
    : `Toggle exception for ${entry.pattern}`;

  const item = cloneTemplate<HTMLDivElement>('options-whitelist-item-template');
  const titleElement = querySelector<HTMLElement>('[data-role="whitelist-title"]', item);
  const patternElement = querySelector<HTMLElement>('[data-role="whitelist-pattern"]', item);
  const toggleInput = querySelector<HTMLInputElement>(
    'input[data-action="toggle-whitelist"]',
    item
  );
  const editButton = querySelector<HTMLButtonElement>(
    'button[data-action="edit-whitelist"]',
    item
  );

  if (description) {
    titleElement.textContent = description;
  } else {
    titleElement.remove();
  }

  patternElement.textContent = entry.pattern;
  toggleInput.checked = entry.enabled;
  toggleInput.dataset.whitelistId = entry.id;
  toggleInput.setAttribute('aria-label', toggleLabel);
  editButton.dataset.whitelistId = entry.id;

  return item;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderSchedules(): void {
  const schedulesList = getElementByIdOrNull('schedules-list');
  if (!schedulesList) return;

  const fragment = document.createDocumentFragment();
  for (const [index, schedule] of temporarySchedules.entries()) {
    const scheduleNumber = index + 1;
    const item = cloneTemplate<HTMLDivElement>('options-schedule-item-template');
    const dayContainer = querySelector<HTMLElement>('[data-role="day-checkboxes"]', item);
    const startInput = querySelector<HTMLInputElement>(
      'input[data-field="startTime"]',
      item
    );
    const endInput = querySelector<HTMLInputElement>(
      'input[data-field="endTime"]',
      item
    );
    const removeButton = querySelector<HTMLButtonElement>(
      'button[data-action="remove-schedule"]',
      item
    );

    for (const [dayIndex, day] of DAY_NAMES.entries()) {
      const label = document.createElement('label');
      label.className = 'day-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = schedule.daysOfWeek.includes(dayIndex);
      input.dataset.action = 'update-schedule-day';
      input.dataset.scheduleIndex = String(index);
      input.dataset.day = String(dayIndex);
      label.appendChild(input);
      label.append(day);
      dayContainer.appendChild(label);
    }

    startInput.value = schedule.startTime;
    startInput.dataset.scheduleIndex = String(index);
    startInput.setAttribute('aria-label', `Start time for schedule ${scheduleNumber}`);

    endInput.value = schedule.endTime;
    endInput.dataset.scheduleIndex = String(index);
    endInput.setAttribute('aria-label', `End time for schedule ${scheduleNumber}`);

    removeButton.dataset.scheduleIndex = String(index);
    removeButton.setAttribute('aria-label', `Delete schedule ${scheduleNumber}`);
    removeButton.title = `Delete schedule ${scheduleNumber}`;

    fragment.appendChild(item);
  }

  schedulesList.replaceChildren(fragment);
}

// ============================================================================
// Filter Modal
// ============================================================================

function openFilterModal(filterId?: string, groupId?: string): void {
  currentEditingFilterId = filterId ?? null;
  currentFilterGroupId = groupId ?? DEFAULT_GROUP_ID;
  const modal = getElementByIdOrNull('filter-modal');
  const title = getElementByIdOrNull('filter-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('filter-form');
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-filter');

  if (!modal || !title || !form) return;

  form.reset();
  title.textContent = filterId ? 'Edit Filter' : 'Add Filter';
  if (deleteButton) {
    deleteButton.style.display = filterId ? 'inline-flex' : 'none';
    deleteButton.disabled = !filterId;
  }

  loadData()
    .then((data) => {
      const filter = filterId ? data.filters.find((f) => f.id === filterId) : undefined;
      const selectedGroupId = filter?.groupId ?? groupId ?? DEFAULT_GROUP_ID;
      currentFilterGroupId = selectedGroupId;

      if (filter) {
        const patternInput = getElementByIdOrNull<HTMLInputElement>('filter-pattern');
        const descInput = getElementByIdOrNull<HTMLInputElement>('filter-description');
        const enabledInput = getElementByIdOrNull<HTMLInputElement>('filter-enabled');
        const matchModeSelect = getElementByIdOrNull<HTMLSelectElement>('filter-match-mode');

        if (patternInput) patternInput.value = filter.pattern;
        if (descInput) descInput.value = filter.description ?? '';
        if (enabledInput) enabledInput.checked = filter.enabled;
        if (matchModeSelect) matchModeSelect.value = filter.matchMode ?? 'contains';
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to load data for filter modal:', error);
    });

  modal.classList.add('active');
  activateModal(modal, '#filter-pattern');
}

function closeFilterModal(): void {
  const modal = getElementByIdOrNull('filter-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
  currentEditingFilterId = null;
  currentFilterGroupId = null;
}

async function handleFilterSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const pattern = getElementByIdOrNull<HTMLInputElement>('filter-pattern')?.value ?? '';
  const description = getElementByIdOrNull<HTMLInputElement>('filter-description')?.value ?? '';
  const groupId = currentFilterGroupId ?? DEFAULT_GROUP_ID;
  const enabled = getElementByIdOrNull<HTMLInputElement>('filter-enabled')?.checked ?? true;
  const matchMode = getMatchModeSelectValue('filter-match-mode');

  if (!ensureValidRegex(pattern, matchMode)) {
    return;
  }

  let expiresAt: number | undefined;
  if (currentEditingFilterId) {
    const data = await loadData();
    expiresAt = data.filters.find((filter) => filter.id === currentEditingFilterId)?.expiresAt;
  }

  const baseFilter: Filter = {
    id: currentEditingFilterId ?? generateId(),
    pattern,
    description,
    groupId,
    enabled,
    matchMode,
  };
  const filter: Filter =
    typeof expiresAt === 'number' ? { ...baseFilter, expiresAt } : baseFilter;

  try {
    if (currentEditingFilterId) {
      await updateFilter(filter);
    } else {
      await addFilter(filter);
    }
    closeFilterModal();
    await renderGroups();
  } catch (error) {
    console.error('Failed to save filter:', error);
    alert('Failed to save filter. Please try again.');
  }
}

async function handleFilterDelete(): Promise<void> {
  if (!currentEditingFilterId) return;

  try {
    await deleteFilter(currentEditingFilterId);
    closeFilterModal();
    await renderGroups();
  } catch (error) {
    console.error('Failed to delete filter:', error);
    alert('Failed to delete filter. Please try again.');
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
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-group');

  if (!modal || !title || !form || !schedulesContainer || !is24x7Checkbox) return;

  form.reset();
  title.textContent = groupId ? 'Edit Group' : 'Add Group';
  if (deleteButton) {
    const allowDelete = Boolean(groupId && groupId !== DEFAULT_GROUP_ID);
    deleteButton.style.display = allowDelete ? 'inline-flex' : 'none';
    deleteButton.disabled = !allowDelete;
  }

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
  activateModal(modal, '#group-name');
}

function closeGroupModal(): void {
  const modal = getElementByIdOrNull('group-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
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
  } catch (error) {
    console.error('Failed to save group:', error);
    alert('Failed to save group. Please try again.');
  }
}

async function handleGroupDelete(): Promise<void> {
  if (!currentEditingGroupId || currentEditingGroupId === DEFAULT_GROUP_ID) return;

  try {
    await deleteGroup(currentEditingGroupId);
    closeGroupModal();
    await renderGroups();
  } catch (error) {
    console.error('Failed to delete group:', error);
    alert('Failed to delete group. Please try again.');
  }
}

// ============================================================================
// Whitelist Modal
// ============================================================================

function openWhitelistModal(whitelistId?: string, groupId?: string): void {
  currentEditingWhitelistId = whitelistId ?? null;
  currentWhitelistGroupId = groupId ?? DEFAULT_GROUP_ID;
  const modal = getElementByIdOrNull('whitelist-modal');
  const title = getElementByIdOrNull('whitelist-modal-title');
  const form = getElementByIdOrNull<HTMLFormElement>('whitelist-form');
  const deleteButton = getElementByIdOrNull<HTMLButtonElement>('delete-whitelist');

  if (!modal || !title || !form) return;

  form.reset();
  title.textContent = whitelistId ? 'Edit Exception' : 'Add Exception';
  if (deleteButton) {
    deleteButton.style.display = whitelistId ? 'inline-flex' : 'none';
    deleteButton.disabled = !whitelistId;
  }

  loadData()
    .then((data) => {
      const entry = whitelistId ? data.whitelist.find((w) => w.id === whitelistId) : undefined;
      const selectedGroupId = entry?.groupId ?? groupId ?? DEFAULT_GROUP_ID;
      currentWhitelistGroupId = selectedGroupId;

      if (entry) {
        const patternInput = getElementByIdOrNull<HTMLInputElement>('whitelist-pattern');
        const descInput = getElementByIdOrNull<HTMLInputElement>('whitelist-description');
        const enabledInput = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled');
        const matchModeSelect = getElementByIdOrNull<HTMLSelectElement>('whitelist-match-mode');

        if (patternInput) patternInput.value = entry.pattern;
        if (descInput) descInput.value = entry.description ?? '';
        if (enabledInput) enabledInput.checked = entry.enabled;
        if (matchModeSelect) matchModeSelect.value = entry.matchMode ?? 'contains';
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to load exception data:', error);
    });

  modal.classList.add('active');
  activateModal(modal, '#whitelist-pattern');
}

function closeWhitelistModal(): void {
  const modal = getElementByIdOrNull('whitelist-modal');
  if (modal?.classList.contains('active')) {
    modal.classList.remove('active');
    deactivateModal(modal);
  }
  currentEditingWhitelistId = null;
  currentWhitelistGroupId = null;
}

async function handleWhitelistSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const pattern = getElementByIdOrNull<HTMLInputElement>('whitelist-pattern')?.value ?? '';
  const description = getElementByIdOrNull<HTMLInputElement>('whitelist-description')?.value ?? '';
  const groupId = currentWhitelistGroupId ?? DEFAULT_GROUP_ID;
  const enabled = getElementByIdOrNull<HTMLInputElement>('whitelist-enabled')?.checked ?? true;
  const matchMode = getMatchModeSelectValue('whitelist-match-mode');

  if (!ensureValidRegex(pattern, matchMode)) {
    return;
  }

  const entry: Whitelist = {
    id: currentEditingWhitelistId ?? generateId(),
    pattern,
    description,
    groupId,
    enabled,
    matchMode,
  };

  try {
    if (currentEditingWhitelistId) {
      await updateWhitelist(entry);
    } else {
      await addWhitelist(entry);
    }
    closeWhitelistModal();
    await renderGroups();
  } catch (error) {
    console.error('Failed to save exception:', error);
    alert('Failed to save exception. Please try again.');
  }
}

async function handleWhitelistDelete(): Promise<void> {
  if (!currentEditingWhitelistId) return;

  try {
    await deleteWhitelist(currentEditingWhitelistId);
    closeWhitelistModal();
    await renderGroups();
  } catch (error) {
    console.error('Failed to delete exception:', error);
    alert('Failed to delete exception. Please try again.');
  }
}

// ============================================================================
// Event Handlers for List Actions
// ============================================================================

function handleGroupsListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const button = target.closest('button[data-action]') as HTMLButtonElement | null;
  if (!button) return;

  if (button.closest('summary')) {
    e.preventDefault();
  }

  const action = button.dataset['action'];
  const groupId = button.dataset['groupId'];
  const filterId = button.dataset['filterId'];
  const whitelistId = button.dataset['whitelistId'];

  if (action === 'edit-group' && groupId) {
    openGroupModal(groupId);
  } else if (action === 'delete-group' && groupId) {
    deleteGroupConfirm(groupId);
  } else if (action === 'add-filter' && groupId) {
    openFilterModal(undefined, groupId);
  } else if (action === 'add-whitelist' && groupId) {
    openWhitelistModal(undefined, groupId);
  } else if (action === 'edit-filter' && filterId) {
    openFilterModal(filterId);
  } else if (action === 'delete-filter' && filterId) {
    deleteFilterConfirm(filterId);
  } else if (action === 'edit-whitelist' && whitelistId) {
    openWhitelistModal(whitelistId);
  } else if (action === 'delete-whitelist' && whitelistId) {
    deleteWhitelistConfirm(whitelistId);
  }
}

function handleGroupsListChange(e: Event): void {
  const target = e.target as HTMLElement;
  const input = target.closest('input[data-action]') as HTMLInputElement | null;

  if (!input) return;

  if (input.dataset['action'] === 'toggle-filter') {
    const filterId = input.dataset['filterId'];
    if (filterId) {
      toggleFilter(filterId, input.checked);
    }
  } else if (input.dataset['action'] === 'toggle-whitelist') {
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

function handleGlobalKeydown(e: KeyboardEvent): void {
  if (activeModal && e.key === 'Tab') {
    trapFocus(e, activeModal);
    return;
  }

  if (e.key !== 'Escape') return;

  const filterModal = getElementByIdOrNull('filter-modal');
  const groupModal = getElementByIdOrNull('group-modal');
  const whitelistModal = getElementByIdOrNull('whitelist-modal');

  if (filterModal?.classList.contains('active')) {
    closeFilterModal();
  } else if (groupModal?.classList.contains('active')) {
    closeGroupModal();
  } else if (whitelistModal?.classList.contains('active')) {
    closeWhitelistModal();
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
    await renderGroups();
  }
}

async function deleteGroupConfirm(groupId: string): Promise<void> {
  if (
    confirm(
      'Are you sure you want to delete this group? Filters and exceptions in this group will be moved to the default 24/7 group.'
    )
  ) {
    await deleteGroup(groupId);
    await renderGroups();
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
  if (confirm('Are you sure you want to delete this exception?')) {
    await deleteWhitelist(whitelistId);
    await renderGroups();
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
