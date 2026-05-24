/**
 * Typed wrapper for chrome.storage.session API
 */

import type {
  BlockedFilterSnapshot,
  BlockedGroupSnapshot,
  BlockedPageState,
  BlockedTabState,
  FilterMatchMode,
  SnoozeState,
  TimeSchedule,
} from '../types';

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;
const SNOOZE_OVERRIDE_KEY = 'snooze_override' as const;
const BLOCKED_TAB_STATE_KEY_PREFIX = 'blocked_tab_state_' as const;
const BLOCKED_PAGE_STATE_KEY_PREFIX = 'blocked_page_state_' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
}

function blockedTabStateKey(tabId: number): string {
  return `${BLOCKED_TAB_STATE_KEY_PREFIX}${tabId}`;
}

function blockedPageStateKey(blockId: string): string {
  return `${BLOCKED_PAGE_STATE_KEY_PREFIX}${blockId}`;
}

/**
 * Store the last allowed URL for a tab in session storage
 */
export async function setLastAllowedUrl(tabId: number, url: string): Promise<void> {
  await chrome.storage.session.set({ [lastAllowedUrlKey(tabId)]: url });
}

/**
 * Get the last allowed URL for a tab from session storage
 */
export async function getLastAllowedUrl(tabId: number): Promise<string | undefined> {
  const key = lastAllowedUrlKey(tabId);
  const result = await chrome.storage.session.get(key);
  const value = result[key];
  return typeof value === 'string' ? value : undefined;
}

function normalizeBlockedTabState(value: unknown): BlockedTabState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedTabState>;
  if (
    typeof candidate.blockId !== 'string' ||
    typeof candidate.tabId !== 'number' ||
    typeof candidate.targetUrl !== 'string' ||
    typeof candidate.blockedAt !== 'number' ||
    typeof candidate.rulesVersion !== 'number' ||
    !candidate.blockedBy ||
    typeof candidate.blockedBy.filterId !== 'string' ||
    typeof candidate.blockedBy.groupId !== 'string'
  ) {
    return undefined;
  }

  return {
    blockId: candidate.blockId,
    tabId: candidate.tabId,
    targetUrl: candidate.targetUrl,
    blockedAt: candidate.blockedAt,
    rulesVersion: candidate.rulesVersion,
    blockedBy: {
      filterId: candidate.blockedBy.filterId,
      groupId: candidate.blockedBy.groupId,
    },
  };
}

export async function setBlockedTabState(state: BlockedTabState): Promise<void> {
  await chrome.storage.session.set({ [blockedTabStateKey(state.tabId)]: state });
}

export async function getBlockedTabState(tabId: number): Promise<BlockedTabState | undefined> {
  const key = blockedTabStateKey(tabId);
  const result = await chrome.storage.session.get(key);
  return normalizeBlockedTabState(result[key]);
}

export async function clearBlockedTabState(tabId: number): Promise<void> {
  const existingState = await getBlockedTabState(tabId);
  const keys = [blockedTabStateKey(tabId)];
  if (existingState) {
    keys.push(blockedPageStateKey(existingState.blockId));
  }
  await chrome.storage.session.remove(keys);
}

function isFilterMatchMode(value: unknown): value is FilterMatchMode {
  return value === 'contains' || value === 'exact' || value === 'regex';
}

function normalizeBlockedFilterSnapshot(value: unknown): BlockedFilterSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedFilterSnapshot>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.pattern !== 'string' ||
    !isFilterMatchMode(candidate.matchMode)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    pattern: candidate.pattern,
    matchMode: candidate.matchMode,
    ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
  };
}

function normalizeSchedule(value: unknown): TimeSchedule | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<TimeSchedule>;
  if (
    !Array.isArray(candidate.daysOfWeek) ||
    !candidate.daysOfWeek.every((day) => typeof day === 'number') ||
    typeof candidate.startTime !== 'string' ||
    typeof candidate.endTime !== 'string'
  ) {
    return undefined;
  }

  return {
    daysOfWeek: candidate.daysOfWeek,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
  };
}

function normalizeBlockedGroupSnapshot(value: unknown): BlockedGroupSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedGroupSnapshot>;
  const schedules = Array.isArray(candidate.schedules)
    ? candidate.schedules.map(normalizeSchedule)
    : undefined;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.is24x7 !== 'boolean' ||
    !schedules ||
    schedules.some((schedule) => !schedule)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    is24x7: candidate.is24x7,
    schedules: schedules.filter((schedule): schedule is TimeSchedule => Boolean(schedule)),
  };
}

function normalizeBlockedPageState(value: unknown): BlockedPageState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedPageState>;
  const tabState = normalizeBlockedTabState(candidate);
  const filter = normalizeBlockedFilterSnapshot(candidate.filter);
  if (!tabState || !filter) {
    return undefined;
  }

  return {
    ...tabState,
    filter,
    group: normalizeBlockedGroupSnapshot(candidate.group),
  };
}

export async function setBlockedPageState(state: BlockedPageState): Promise<void> {
  await chrome.storage.session.set({ [blockedPageStateKey(state.blockId)]: state });
}

export async function getBlockedPageState(blockId: string): Promise<BlockedPageState | undefined> {
  const key = blockedPageStateKey(blockId);
  const result = await chrome.storage.session.get(key);
  return normalizeBlockedPageState(result[key]);
}

export async function clearBlockedPageState(blockId: string): Promise<void> {
  await chrome.storage.session.remove(blockedPageStateKey(blockId));
}

function normalizeSessionSnooze(value: unknown): SnoozeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { active?: unknown; until?: unknown };
  if (typeof candidate.active !== 'boolean') {
    return undefined;
  }

  if (!candidate.active) {
    return { active: false };
  }

  if (typeof candidate.until === 'number' && Number.isFinite(candidate.until)) {
    return { active: true, until: candidate.until };
  }

  return { active: true };
}

export async function setSessionSnooze(snooze: SnoozeState): Promise<void> {
  await chrome.storage.session.set({ [SNOOZE_OVERRIDE_KEY]: snooze });
}

export async function getSessionSnooze(): Promise<SnoozeState | undefined> {
  const result = await chrome.storage.session.get(SNOOZE_OVERRIDE_KEY);
  return normalizeSessionSnooze(result[SNOOZE_OVERRIDE_KEY]);
}
