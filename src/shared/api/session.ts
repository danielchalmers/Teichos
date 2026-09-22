/**
 * Typed wrapper for chrome.storage.session API
 */

import type {
  BlockedEffectiveState,
  BlockedFilterSnapshot,
  BlockedGroupSnapshot,
  BlockedPageState,
  BlockedTabState,
  BypassState,
  FilterMatchMode,
  SnoozeState,
  TimeSchedule,
} from '../types';

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;
const SNOOZE_OVERRIDE_KEY = 'snooze_override' as const;
const BLOCKED_TAB_STATE_KEY_PREFIX = 'blocked_tab_state_' as const;
const BLOCKED_PAGE_STATE_KEY_PREFIX = 'blocked_page_state_' as const;
const BYPASS_KEY_PREFIX = 'bypass_' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
}

function blockedTabStateKey(tabId: number): string {
  return `${BLOCKED_TAB_STATE_KEY_PREFIX}${tabId}`;
}

function blockedPageStateKey(blockId: string): string {
  return `${BLOCKED_PAGE_STATE_KEY_PREFIX}${blockId}`;
}

function bypassKey(tabId: number): string {
  return `${BYPASS_KEY_PREFIX}${tabId}`;
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
  await chrome.storage.session.remove(blockedTabStateKey(tabId));
}

function normalizeBypassState(value: unknown): BypassState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BypassState>;
  if (typeof candidate.filterId !== 'string' || typeof candidate.urlKey !== 'string') {
    return undefined;
  }

  return {
    filterId: candidate.filterId,
    urlKey: candidate.urlKey,
  };
}

export async function setBypassState(tabId: number, state: BypassState): Promise<void> {
  await chrome.storage.session.set({ [bypassKey(tabId)]: state });
}

export async function getBypassState(tabId: number): Promise<BypassState | undefined> {
  const key = bypassKey(tabId);
  const result = await chrome.storage.session.get(key);
  return normalizeBypassState(result[key]);
}

export async function clearBypassState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(bypassKey(tabId));
}

export interface TabSessionState {
  readonly lastAllowedUrl: string | undefined;
  readonly blockedTabState: BlockedTabState | undefined;
  readonly bypass: BypassState | undefined;
}

/**
 * Read every per-tab record in one storage call. Navigation handling needs all of them, and this
 * runs for every main-frame navigation and for every open tab when the service worker wakes.
 */
export async function getTabSessionState(tabId: number): Promise<TabSessionState> {
  const lastAllowedKey = lastAllowedUrlKey(tabId);
  const blockedKey = blockedTabStateKey(tabId);
  const bypassStateKey = bypassKey(tabId);
  const result = await chrome.storage.session.get([lastAllowedKey, blockedKey, bypassStateKey]);
  const lastAllowedUrl = result[lastAllowedKey];
  return {
    lastAllowedUrl: typeof lastAllowedUrl === 'string' ? lastAllowedUrl : undefined,
    blockedTabState: normalizeBlockedTabState(result[blockedKey]),
    bypass: normalizeBypassState(result[bypassStateKey]),
  };
}

/**
 * Remove everything stored for a tab that no longer exists, including the snapshot of every block
 * it showed. Nothing else deletes these, so without this session storage grows with every block
 * until it hits its quota, after which new blocks can no longer be recorded.
 */
export async function clearTabSessionState(tabId: number): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const keys = [lastAllowedUrlKey(tabId), blockedTabStateKey(tabId), bypassKey(tabId)];
  for (const [key, value] of Object.entries(all)) {
    if (
      key.startsWith(BLOCKED_PAGE_STATE_KEY_PREFIX) &&
      (value as { tabId?: unknown } | null)?.tabId === tabId
    ) {
      keys.push(key);
    }
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
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
    schedules: schedules.filter((schedule): schedule is TimeSchedule => Boolean(schedule)),
  };
}

function normalizeBlockedEffectiveState(value: unknown): BlockedEffectiveState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedEffectiveState>;
  if (
    typeof candidate.filterEnabled !== 'boolean' ||
    typeof candidate.groupActive !== 'boolean' ||
    typeof candidate.snoozeActive !== 'boolean'
  ) {
    return undefined;
  }

  return {
    filterEnabled: candidate.filterEnabled,
    groupActive: candidate.groupActive,
    snoozeActive: candidate.snoozeActive,
  };
}

function normalizeBlockedPageState(value: unknown): BlockedPageState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BlockedPageState>;
  const tabState = normalizeBlockedTabState(candidate);
  const filter = normalizeBlockedFilterSnapshot(candidate.filter);
  const effectiveState = normalizeBlockedEffectiveState(candidate.effectiveState);
  if (!tabState || !filter || !effectiveState) {
    return undefined;
  }

  return {
    ...tabState,
    filter,
    group: normalizeBlockedGroupSnapshot(candidate.group),
    effectiveState,
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
