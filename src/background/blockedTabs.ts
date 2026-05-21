import { getExtensionUrl } from '../shared/api/runtime';
import { setRestoreBypassUrl } from '../shared/api/session';
import { queryTabs, updateTabUrl } from '../shared/api/tabs';
import { PAGES } from '../shared/constants';
import type { StorageData } from '../shared/types';
import {
  buildBlockingIndex,
  isInternalUrl,
  isSnoozeActive,
  shouldBlockUrlWithIndex,
} from '../shared/utils';

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

function shouldRestoreBlockedTarget(targetUrl: string, data: StorageData): boolean {
  if (isSnoozeActive(data.snooze)) {
    return true;
  }

  const blockingIndex = buildBlockingIndex(data.filters, data.groups, data.whitelist);
  return shouldBlockUrlWithIndex(targetUrl, blockingIndex) === undefined;
}

export async function restoreBlockedTabsIfUnblocked(data: StorageData): Promise<void> {
  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  const tabs = await queryTabs({});
  const results = await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!tab.url || typeof tab.id !== 'number') {
        return;
      }

      const blockedTargetUrl = getBlockedTargetUrl(tab.url, blockedPageUrl);
      if (!blockedTargetUrl || !shouldRestoreBlockedTarget(blockedTargetUrl, data)) {
        return;
      }

      await setRestoreBypassUrl(tab.id, blockedTargetUrl);
      console.warn('[Teichos trace] Restoring stale blocked tab', {
        tabId: tab.id,
        targetUrl: blockedTargetUrl,
      });
      await updateTabUrl(tab.id, blockedTargetUrl);
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Teichos] Failed to restore blocked tab:', result.reason);
    }
  }
}
