/**
 * Keeps snooze alarm state in sync with stored snooze settings.
 */

import { loadData, saveData } from '../shared/api';
import { getExtensionUrl } from '../shared/api/runtime';
import { setLastAllowedUrl, setSessionSnooze } from '../shared/api/session';
import { queryTabs, updateTabUrl } from '../shared/api/tabs';
import { ALARMS, PAGES } from '../shared/constants';
import type { SnoozeState } from '../shared/types';
import { STORAGE_KEY } from '../shared/types';
import { isInternalUrl, isSnoozeActive, isSnoozeExpired } from '../shared/utils';

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

function getBlockedTargetUrl(tabUrl: string, blockedPageUrl: string): string | null {
  if (!tabUrl.startsWith(blockedPageUrl)) {
    return null;
  }

  try {
    const blockedTargetUrl = new URL(tabUrl).searchParams.get('url');
    if (
      !blockedTargetUrl ||
      isInternalUrl(blockedTargetUrl) ||
      blockedTargetUrl.startsWith(blockedPageUrl)
    ) {
      return null;
    }
    return blockedTargetUrl;
  } catch {
    return null;
  }
}

async function restoreBlockedTabsIfSnoozed(snooze: SnoozeState): Promise<void> {
  if (!isSnoozeActive(snooze)) {
    return;
  }

  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  const tabs = await queryTabs({});
  const results = await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!tab.url || typeof tab.id !== 'number') {
        return;
      }

      const blockedTargetUrl = getBlockedTargetUrl(tab.url, blockedPageUrl);
      if (!blockedTargetUrl) {
        return;
      }

      await setLastAllowedUrl(tab.id, blockedTargetUrl);
      await updateTabUrl(tab.id, blockedTargetUrl);
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Teichos] Failed to restore blocked tab while snoozed:', result.reason);
    }
  }
}

async function syncSnoozeFromStorage(): Promise<void> {
  const data = await loadData();
  if (!isSnoozeExpired(data.snooze)) {
    syncAlarmFromSnooze(data.snooze);
    await setSessionSnooze(data.snooze);
    await restoreBlockedTabsIfSnoozed(data.snooze);
    return;
  }

  await saveData({
    ...data,
    snooze: INACTIVE_SNOOZE,
  });
  await setSessionSnooze(INACTIVE_SNOOZE);
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
  await setSessionSnooze(INACTIVE_SNOOZE);
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
