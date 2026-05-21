/**
 * Typed wrapper for chrome.storage.session API
 */

import type { BlockedTabState, SnoozeState, WarningBypass, WarningTabState } from '../types';

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;
const SNOOZE_OVERRIDE_KEY = 'snooze_override' as const;
const BLOCKED_TAB_STATE_KEY_PREFIX = 'blocked_tab_state_' as const;
const WARNING_TAB_STATE_KEY_PREFIX = 'warning_tab_state_' as const;
const WARNING_BYPASS_KEY_PREFIX = 'warning_bypass_' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
}

function blockedTabStateKey(tabId: number): string {
  return `${BLOCKED_TAB_STATE_KEY_PREFIX}${tabId}`;
}

function warningTabStateKey(tabId: number): string {
  return `${WARNING_TAB_STATE_KEY_PREFIX}${tabId}`;
}

function warningBypassKey(tabId: number): string {
  return `${WARNING_BYPASS_KEY_PREFIX}${tabId}`;
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
  await chrome.storage.session.remove(blockedTabStateKey(tabId));
}

function normalizeWarningTabState(value: unknown): WarningTabState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<WarningTabState>;
  if (
    typeof candidate.tabId !== 'number' ||
    typeof candidate.targetUrl !== 'string' ||
    typeof candidate.warningAt !== 'number' ||
    typeof candidate.rulesVersion !== 'number' ||
    typeof candidate.bypassKey !== 'string' ||
    !candidate.warnedBy ||
    typeof candidate.warnedBy.filterId !== 'string' ||
    typeof candidate.warnedBy.groupId !== 'string'
  ) {
    return undefined;
  }

  return {
    tabId: candidate.tabId,
    targetUrl: candidate.targetUrl,
    warningAt: candidate.warningAt,
    rulesVersion: candidate.rulesVersion,
    bypassKey: candidate.bypassKey,
    warnedBy: {
      filterId: candidate.warnedBy.filterId,
      groupId: candidate.warnedBy.groupId,
    },
  };
}

export async function setWarningTabState(state: WarningTabState): Promise<void> {
  await chrome.storage.session.set({ [warningTabStateKey(state.tabId)]: state });
}

export async function getWarningTabState(tabId: number): Promise<WarningTabState | undefined> {
  const key = warningTabStateKey(tabId);
  const result = await chrome.storage.session.get(key);
  return normalizeWarningTabState(result[key]);
}

export async function clearWarningTabState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(warningTabStateKey(tabId));
}

function normalizeWarningBypasses(value: unknown): WarningBypass[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry['filterId'] !== 'string' ||
      typeof entry['urlKey'] !== 'string'
    ) {
      return [];
    }

    return [{ filterId: entry['filterId'], urlKey: entry['urlKey'] }];
  });
}

export async function getWarningBypasses(tabId: number): Promise<WarningBypass[]> {
  const key = warningBypassKey(tabId);
  const result = await chrome.storage.session.get(key);
  return normalizeWarningBypasses(result[key]);
}

export async function addWarningBypass(tabId: number, bypass: WarningBypass): Promise<void> {
  const existing = await getWarningBypasses(tabId);
  const bypasses = existing.some(
    (entry) => entry.filterId === bypass.filterId && entry.urlKey === bypass.urlKey
  )
    ? existing
    : [...existing, bypass];

  await chrome.storage.session.set({ [warningBypassKey(tabId)]: bypasses });
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
