/**
 * Helpers for evaluating whether filtering should be bypassed due to snooze.
 *
 * This deliberately checks raw sync storage as a fallback to avoid any
 * normalization/cache race conditions when snooze is toggled.
 */

import { getSessionSnooze } from '../shared/api/session';
import { isSnoozeActive } from '../shared/filtering/schedules';
import { decodeSettings } from '../shared/storage/syncLayout';

interface RawSnoozeState {
  readonly active?: unknown;
  readonly until?: unknown;
}

function isRawSnoozeActive(snooze: RawSnoozeState | undefined, now = Date.now()): boolean {
  if (snooze?.active !== true) {
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

  const rawData = decodeSettings(await chrome.storage.sync.get(null)).raw as
    { snooze?: RawSnoozeState } | undefined;
  return isRawSnoozeActive(rawData?.snooze);
}
