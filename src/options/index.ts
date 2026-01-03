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
import { escapeHtml, generateId } from '../shared/utils';
import { getElementByIdOrNull } from '../shared/utils/dom';
import { DAY_NAMES, DEFAULT_SCHEDULE } from '../shared/constants';

const ADD_ICON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" role="img">' +
  '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';
const EDIT_ICON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" role="img">' +
  '<path d="M3 11.5V13h1.5l7-7-1.5-1.5-7 7z" fill="currentColor"/>' +
  '<path d="M10.5 3.5l1.5 1.5 1-1a1 1 0 0 0 0-1.4l-.6-.6a1 1 0 0 0-1.4 0l-1 1z" fill="currentColor"/>' +
  '</svg>';
const MINUS_ICON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" role="img">' +
  '<path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';
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
  if (!filterId) return;

  openFilterModal(filterId);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('editFilter');
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

  groupsList.innerHTML = data.groups
    .map((group) => {
      const filters = filtersByGroup.get(group.id) ?? [];
      const whitelist = whitelistByGroup.get(group.id) ?? [];
      const isDefault = group.id === DEFAULT_GROUP_ID;
      const scheduleSummary = group.is24x7
        ? 'Always Active'
        : pluralize(group.schedules.length, 'schedule');
      const filterSummary = pluralize(filters.length, 'filter');
      const exceptionSummary = pluralize(whitelist.length, 'exception', 'exceptions');

      return `
        <details class="group-item" data-group-id="${group.id}">
          <summary class="group-header">
            <div class="group-info">
              <div class="group-title">${escapeHtml(group.name)}</div>
              <div class="filter-meta">${scheduleSummary} • ${filterSummary} • ${exceptionSummary}</div>
            </div>
            <div class="actions">
              ${
                !isDefault
                  ? `<button class="button small secondary" data-action="edit-group" data-group-id="${group.id}">
                      <span class="button-icon" aria-hidden="true">${EDIT_ICON_SVG}</span>
                      Edit
                    </button>`
                  : ''
              }
            </div>
          </summary>
          <div class="group-content">
            <div class="group-section">
              <div class="group-section-header">
                <h3>Filters</h3>
              </div>
              ${
                filters.length === 0
                  ? '<p class="empty-state">No filters in this group.</p>'
                  : filters.map(renderFilterItem).join('')
              }
              <div class="list-footer">
                <button class="button small" data-action="add-filter" data-group-id="${group.id}">
                  <span class="button-icon" aria-hidden="true">${ADD_ICON_SVG}</span>
                  New Filter
                </button>
              </div>
            </div>
            <div class="group-section">
              <div class="group-section-header">
                <h3>Exceptions</h3>
              </div>
              ${
                whitelist.length === 0
                  ? '<p class="empty-state">No exceptions in this group.</p>'
                  : whitelist.map(renderWhitelistItem).join('')
              }
              <div class="list-footer">
                <button class="button small secondary" data-action="add-whitelist" data-group-id="${group.id}">
                  <span class="button-icon" aria-hidden="true">${ADD_ICON_SVG}</span>
                  New Exception
                </button>
              </div>
            </div>
          </div>
        </details>
      `;
    })
    .join('');

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

function getMatchModeSelectValue(selectId: string): FilterMatchMode {
  const value = getElementByIdOrNull<HTMLSelectElement>(selectId)?.value;
  if (value === 'contains' || value === 'exact' || value === 'regex') {
    return value;
  }
  return 'contains';
}

function renderFilterItem(filter: Filter): string {
  const description = filter.description?.trim();
  const nameMarkup = description ? `<div class="filter-title">${escapeHtml(description)}</div>` : '';
  const toggleLabel = description
    ? `Toggle filter ${description}`
    : `Toggle filter for ${filter.pattern}`;

  return `
    <div class="filter-item">
      <div class="filter-details">
        ${nameMarkup}
        <div class="filter-pattern">${escapeHtml(filter.pattern)}</div>
      </div>
      <div class="actions">
        <label class="toggle">
          <input type="checkbox" ${filter.enabled ? 'checked' : ''} data-action="toggle-filter" data-filter-id="${filter.id}" aria-label="${escapeHtml(toggleLabel)}">
          <span class="slider"></span>
        </label>
        <button class="button small secondary" data-action="edit-filter" data-filter-id="${filter.id}">
          <span class="button-icon" aria-hidden="true">${EDIT_ICON_SVG}</span>
          Edit
        </button>
      </div>
    </div>
  `;
}

function renderWhitelistItem(entry: Whitelist): string {
  const description = entry.description?.trim();
  const nameMarkup = description ? `<div class="filter-title">${escapeHtml(description)}</div>` : '';
  const toggleLabel = description
    ? `Toggle exception ${description}`
    : `Toggle exception for ${entry.pattern}`;

  return `
    <div class="filter-item">
      <div class="filter-details">
        ${nameMarkup}
        <div class="filter-pattern">${escapeHtml(entry.pattern)}</div>
      </div>
      <div class="actions">
        <label class="toggle">
          <input type="checkbox" ${entry.enabled ? 'checked' : ''} data-action="toggle-whitelist" data-whitelist-id="${entry.id}" aria-label="${escapeHtml(toggleLabel)}">
          <span class="slider"></span>
        </label>
        <button class="button small secondary" data-action="edit-whitelist" data-whitelist-id="${entry.id}">
          <span class="button-icon" aria-hidden="true">${EDIT_ICON_SVG}</span>
          Edit
        </button>
      </div>
    </div>
  `;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderSchedules(): void {
  const schedulesList = getElementByIdOrNull('schedules-list');
  if (!schedulesList) return;

  schedulesList.innerHTML = temporarySchedules
    .map((schedule, index) => {
      const scheduleNumber = index + 1;
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
            <input type="time" value="${schedule.startTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="startTime" class="input" aria-label="Start time for schedule ${scheduleNumber}">
            <span>to</span>
            <input type="time" value="${schedule.endTime}" data-action="update-schedule-time" data-schedule-index="${index}" data-field="endTime" class="input" aria-label="End time for schedule ${scheduleNumber}">
            <button type="button" class="icon-button small" data-action="remove-schedule" data-schedule-index="${index}" aria-label="Delete schedule ${scheduleNumber}" title="Delete schedule ${scheduleNumber}">
              <span class="button-icon" aria-hidden="true">${MINUS_ICON_SVG}</span>
              <span class="sr-only">Delete</span>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
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

  // Validate regex if regex mode is enabled
  if (matchMode === 'regex') {
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
    matchMode,
  };

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

  // Validate regex if regex mode is enabled
  if (matchMode === 'regex') {
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
