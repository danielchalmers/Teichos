/**
 * Keeps snooze alarm state in sync with stored snooze settings.
 */

import { setSessionSnooze } from '../shared/api/session';
import { updateData } from '../shared/api/storage';
import { ALARMS } from '../shared/constants';
import { isSnoozeExpired } from '../shared/filtering/schedules';
import type { SnoozeState } from '../shared/types';
import { STORAGE_KEY } from '../shared/types';

const INACTIVE_SNOOZE: SnoozeState = { active: false };

let didRegisterListeners = false;
let syncQueue: Promise<void> = Promise.resolve();

function syncAlarmFromSnooze(snooze: SnoozeState): void {
  if (!snooze.active) {
    void chrome.alarms.clear(ALARMS.SNOOZE_EXPIRATION);
    return;
  }

  if (isSnoozeExpired(snooze)) {
    void chrome.alarms.clear(ALARMS.SNOOZE_EXPIRATION);
    return;
  }

  if (typeof snooze.until === 'number' && Number.isFinite(snooze.until)) {
    void chrome.alarms.create(ALARMS.SNOOZE_EXPIRATION, { when: snooze.until });
    return;
  }

  // "Always" snooze should not keep an alarm active.
  void chrome.alarms.clear(ALARMS.SNOOZE_EXPIRATION);
}

async function syncSnoozeFromStorage(): Promise<void> {
  // updateData retries on concurrent writes, so clearing an expired snooze cannot
  // clobber filters or groups another surface saved in the meantime.
  const data = await updateData((current) =>
    isSnoozeExpired(current.snooze) ? { ...current, snooze: INACTIVE_SNOOZE } : current
  );
  syncAlarmFromSnooze(data.snooze);
  await setSessionSnooze(data.snooze);
}

function queueSnoozeSync(): void {
  syncQueue = syncQueue
    .then(() => syncSnoozeFromStorage())
    .catch((error: unknown) => {
      console.error('[Teichos] Failed to sync snooze alarm:', error);
    });
}

export function registerSnoozeHandlers(): void {
  if (didRegisterListeners) {
    return;
  }
  didRegisterListeners = true;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) {
      return;
    }
    queueSnoozeSync();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARMS.SNOOZE_EXPIRATION) {
      return;
    }
    queueSnoozeSync();
  });

  queueSnoozeSync();
}
