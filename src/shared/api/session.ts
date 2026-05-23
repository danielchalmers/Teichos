/**
 * Typed wrapper for chrome.storage.session API
 */

import type { BlockedTabState, SnoozeState, WarningBypassState } from '../types';

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;
const SNOOZE_OVERRIDE_KEY = 'snooze_override' as const;
const BLOCKED_TAB_STATE_KEY_PREFIX = 'blocked_tab_state_' as const;
const WARNING_BYPASS_KEY_PREFIX = 'warning_bypass_' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
}

function blockedTabStateKey(tabId: number): string {
  return `${BLOCKED_TAB_STATE_KEY_PREFIX}${tabId}`;
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
    blockType: candidate.blockType === 'warning' ? 'warning' : 'block',
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

function normalizeWarningBypasses(value: unknown): WarningBypassState[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as WarningBypassState).filterId !== 'string' ||
      typeof (entry as WarningBypassState).scopeKey !== 'string'
    ) {
      return [];
    }

    return [
      {
        filterId: (entry as WarningBypassState).filterId,
        scopeKey: (entry as WarningBypassState).scopeKey,
      },
    ];
  });
}

export async function getWarningBypasses(tabId: number): Promise<WarningBypassState[]> {
  const key = warningBypassKey(tabId);
  const result = await chrome.storage.session.get(key);
  return normalizeWarningBypasses(result[key]);
}

export async function addWarningBypass(
  tabId: number,
  warningBypass: WarningBypassState
): Promise<void> {
  const key = warningBypassKey(tabId);
  const existing = await getWarningBypasses(tabId);
  const next = [
    ...existing.filter(
      (entry) =>
        entry.filterId !== warningBypass.filterId || entry.scopeKey !== warningBypass.scopeKey
    ),
    warningBypass,
  ];
  await chrome.storage.session.set({ [key]: next });
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
