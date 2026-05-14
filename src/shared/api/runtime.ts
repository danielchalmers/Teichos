/**
 * Typed wrapper for chrome.runtime API
 */

import { OPTIONS_ROUTE_INTENT, PAGES } from '../constants';
import { MessageType } from '../types';
import { createTab, queryTabs, removeTabs, updateTab } from './tabs';

/**
 * Get the full URL for an extension resource
 */
export function getExtensionUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

/**
 * Open the extension's options page
 */
export function openOptionsPage(): Promise<chrome.tabs.Tab | undefined> {
  return openOrFocusOptionsPage();
}

/**
 * Open the extension's options page with query params
 */
export async function openOptionsPageWithParams(
  params: Record<string, string>
): Promise<chrome.tabs.Tab | undefined> {
  await chrome.storage.session.set({ [OPTIONS_ROUTE_INTENT]: params });

  return openOrFocusOptionsPage(undefined, params);
}

/**
 * Get the extension's unique ID
 */
export function getExtensionId(): string {
  return chrome.runtime.id;
}

function getOptionsPageUrl(): string {
  return getExtensionUrl(PAGES.OPTIONS);
}

/**
 * Open or focus the in-app settings page.
 *
 * targetUrl is used when a navigation should land on a specific extension URL.
 * routeParams carries modal/edit intents that are delivered via session storage and
 * runtime messaging because Plasmo strips hash/query state from routed pages.
 */
async function openOrFocusOptionsPage(
  targetUrl?: string,
  routeParams?: Record<string, string>
): Promise<chrome.tabs.Tab | undefined> {
  const optionsUrl = getOptionsPageUrl();
  const tabs = await queryTabs({});
  const optionsTabs = tabs.filter((tab) => tab.url?.startsWith(optionsUrl));

  if (optionsTabs.length > 0) {
    const [primary, ...rest] = optionsTabs;
    if (!primary) return undefined;
    const primaryId = primary.id;
    const restIds = rest
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number' && id !== primaryId);
    await removeTabs(restIds);

    if (typeof primaryId !== 'number') {
      return undefined;
    }

    const updateProps: chrome.tabs.UpdateProperties = { active: true };
    if (targetUrl && primary.url !== targetUrl) {
      updateProps.url = targetUrl;
    }
    const updatedTab = await updateTab(primaryId, updateProps);
    if (routeParams) {
      await chrome.runtime.sendMessage({
        type: MessageType.OPEN_OPTIONS_ROUTE,
        params: routeParams,
      });
    }
    return updatedTab;
  }

  return createTab({ url: targetUrl ?? optionsUrl });
}
