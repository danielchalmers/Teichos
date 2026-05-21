/**
 * Typed wrapper for chrome.storage.session API
 */

import type { SnoozeState } from '../types';

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;
const SNOOZE_OVERRIDE_KEY = 'snooze_override' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
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
