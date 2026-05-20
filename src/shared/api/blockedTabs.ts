import { PAGES } from '../constants';
import type { StorageData } from '../types';
import {
  buildBlockingIndex,
  isInternalUrl,
  isSnoozeActive,
  shouldBlockUrlWithIndex,
} from '../utils';
import { getExtensionUrl } from './runtime';
import { setRestoreBypassUrl } from './session';
import { queryTabs, updateTabUrl } from './tabs';

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

export function shouldRestoreBlockedTarget(targetUrl: string, data: StorageData): boolean {
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
      console.debug('[Teichos] Restoring unblocked tab target', {
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
