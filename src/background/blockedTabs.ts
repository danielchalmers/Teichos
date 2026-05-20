/**
 * Helpers for returning blocked-page tabs to their target URL when blocking no longer applies.
 */

import { getExtensionUrl } from '../shared/api/runtime';
import { setLastAllowedUrl } from '../shared/api/session';
import { queryTabs, updateTabUrl } from '../shared/api/tabs';
import { PAGES } from '../shared/constants';
import type { StorageData } from '../shared/types';
import {
  buildBlockingIndex,
  isInternalUrl,
  isSnoozeActive,
  shouldBlockUrlWithIndex,
} from '../shared/utils';

export function getBlockedTargetUrl(
  tabUrl: string,
  blockedPageUrl = getExtensionUrl(PAGES.BLOCKED)
): string | null {
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

export function isBlockedTargetAllowed(targetUrl: string, data: StorageData): boolean {
  if (isSnoozeActive(data.snooze)) {
    return true;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  return shouldBlockUrlWithIndex(targetUrl, blockingIndex) === undefined;
}

export async function restoreBlockedTabIfAllowed(
  tabId: number,
  tabUrl: string,
  data: StorageData,
  blockedPageUrl = getExtensionUrl(PAGES.BLOCKED)
): Promise<boolean> {
  const blockedTargetUrl = getBlockedTargetUrl(tabUrl, blockedPageUrl);
  if (!blockedTargetUrl || !isBlockedTargetAllowed(blockedTargetUrl, data)) {
    return false;
  }

  await setLastAllowedUrl(tabId, blockedTargetUrl);
  await updateTabUrl(tabId, blockedTargetUrl);
  return true;
}

export async function restoreBlockedTabsIfAllowed(data: StorageData): Promise<void> {
  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  const tabs = await queryTabs({});
  const results = await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!tab.url || typeof tab.id !== 'number') {
        return;
      }

      await restoreBlockedTabIfAllowed(tab.id, tab.url, data, blockedPageUrl);
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Teichos] Failed to restore blocked tab:', result.reason);
    }
  }
}
