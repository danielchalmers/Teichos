/**
 * Keeps snooze alarm state in sync with stored snooze settings.
 */

import { loadData, saveData } from '../shared/api';
import { ALARMS } from '../shared/constants';
import type { SnoozeState } from '../shared/types';
import { STORAGE_KEY } from '../shared/types';
import { isSnoozeExpired } from '../shared/utils';

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
    chrome.alarms.create(ALARMS.SNOOZE_EXPIRATION, { when: snooze.until });
    return;
  }

  // "Always" snooze should not keep an alarm active.
  void chrome.alarms.clear(ALARMS.SNOOZE_EXPIRATION);
}

async function syncSnoozeFromStorage(): Promise<void> {
  const data = await loadData();
  if (!isSnoozeExpired(data.snooze)) {
    syncAlarmFromSnooze(data.snooze);
    return;
  }

  await saveData({
    ...data,
    snooze: INACTIVE_SNOOZE,
  });
  syncAlarmFromSnooze(INACTIVE_SNOOZE);
}

async function handleSnoozeAlarm(): Promise<void> {
  const data = await loadData();
  if (!isSnoozeExpired(data.snooze)) {
    syncAlarmFromSnooze(data.snooze);
    return;
  }

  await saveData({
    ...data,
    snooze: INACTIVE_SNOOZE,
  });
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
    void handleSnoozeAlarm().catch((error: unknown) => {
      console.error('[Teichos] Failed to process snooze alarm:', error);
    });
  });

  queueSnoozeSync();
}
