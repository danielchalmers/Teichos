/**
 * Cached storage snapshot for the background service worker.
 */

import { loadData } from '../shared/api';
import { STORAGE_KEY } from '../shared/types';
import type { StorageData } from '../shared/types';
import { buildBlockingIndex, type BlockingIndex } from '../shared/utils';

export type StorageSnapshot = {
  data: StorageData;
  blockingIndex: BlockingIndex;
};

let cachedSnapshot: StorageSnapshot | null = null;
let pendingLoad: Promise<StorageSnapshot> | null = null;
let cacheEpoch = 0;

function buildSnapshot(data: StorageData): StorageSnapshot {
  return {
    data,
    blockingIndex: buildBlockingIndex(data.filters, data.groups, data.whitelist),
  };
}

function invalidateCache(): void {
  cacheEpoch += 1;
  cachedSnapshot = null;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }
  if (!changes[STORAGE_KEY]) {
    return;
  }
  invalidateCache();
});

export async function getStorageSnapshot(): Promise<StorageSnapshot> {
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  if (!pendingLoad) {
    const requestEpoch = cacheEpoch;
    pendingLoad = loadData()
      .then((data) => {
        const snapshot = buildSnapshot(data);
        if (cacheEpoch === requestEpoch) {
          cachedSnapshot = snapshot;
        }
        return snapshot;
      })
      .finally(() => {
        pendingLoad = null;
      });
  }

  return pendingLoad;
}
