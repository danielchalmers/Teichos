/**
 * Typed wrapper for chrome.runtime API
 */

/**
 * Get the full URL for an extension resource
 */
export function getExtensionUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

/**
 * Open the extension's options page
 */
export async function openOptionsPage(): Promise<void> {
  await openOrFocusOptionsPage();
}

/**
 * Open the extension's options page with query params
 */
export function openOptionsPageWithParams(
  params: Record<string, string>
): Promise<chrome.tabs.Tab | undefined> {
  const url = new URL(getOptionsPageUrl());
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return openOrFocusOptionsPage(url.toString());
}

/**
 * Get the extension's unique ID
 */
export function getExtensionId(): string {
  return chrome.runtime.id;
}

function getOptionsPageUrl(): string {
  return getExtensionUrl('options/index.html');
}

function queryAllTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tabs);
      }
    });
  });
}

function updateTab(
  tabId: number,
  updateProps: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProps, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function createTab(createProps: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProps, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function removeTabs(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabIds, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

async function openOrFocusOptionsPage(
  targetUrl?: string
): Promise<chrome.tabs.Tab | undefined> {
  const optionsUrl = getOptionsPageUrl();
  const tabs = await queryAllTabs();
  const optionsTabs = tabs.filter((tab) => tab.url?.startsWith(optionsUrl));

  if (optionsTabs.length > 0) {
    const [primary, ...rest] = optionsTabs;
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
    return updateTab(primaryId, updateProps);
  }

  return createTab({ url: targetUrl ?? optionsUrl });
}
