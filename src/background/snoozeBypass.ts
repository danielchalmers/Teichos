/**
 * Helpers for evaluating whether filtering should be bypassed due to snooze.
 *
 * This deliberately checks raw sync storage as a fallback to avoid any
 * normalization/cache race conditions when snooze is toggled.
 */

import { getSessionSnooze } from '../shared/api/session';
import { STORAGE_KEY } from '../shared/types';
import { isSnoozeActive } from '../shared/utils';

type RawSnoozeState = {
  readonly active?: unknown;
  readonly until?: unknown;
};

function isRawSnoozeActive(snooze: RawSnoozeState | undefined, now = Date.now()): boolean {
  if (!snooze || snooze.active !== true) {
    return false;
  }

  if (typeof snooze.until !== 'number' || !Number.isFinite(snooze.until)) {
    return true;
  }

  return snooze.until > now;
}

export async function isSnoozeBypassActive(): Promise<boolean> {
  const sessionSnooze = await getSessionSnooze();
  if (isSnoozeActive(sessionSnooze)) {
    return true;
  }

  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const rawData = result[STORAGE_KEY] as { snooze?: RawSnoozeState } | undefined;
  return isRawSnoozeActive(rawData?.snooze);
}
