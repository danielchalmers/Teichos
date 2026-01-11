/**
 * Typed wrapper for chrome.tabs API
 */

function handleRuntimeError(reject: (error: Error) => void): boolean {
  if (chrome.runtime.lastError) {
    reject(new Error(chrome.runtime.lastError.message));
    return true;
  }
  return false;
}

/**
 * Query tabs by criteria
 */
export function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (handleRuntimeError(reject)) {
        return;
      }
      resolve(tabs);
    });
  });
}

/**
 * Update a tab's properties
 */
export function updateTab(
  tabId: number,
  updateProps: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProps, (tab) => {
      if (handleRuntimeError(reject)) {
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * Create a new tab
 */
export function createTab(
  createProps: chrome.tabs.CreateProperties
): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProps, (tab) => {
      if (handleRuntimeError(reject)) {
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * Remove tabs by ID
 */
export function removeTabs(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabIds, () => {
      if (handleRuntimeError(reject)) {
        return;
      }
      resolve();
    });
  });
}

/**
 * Update a tab's URL
 */
export async function updateTabUrl(
  tabId: number,
  url: string
): Promise<chrome.tabs.Tab> {
  return updateTab(tabId, { url });
}

/**
 * Get the current active tab
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  return tab;
}

/**
 * Get a tab by ID
 */
export function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (handleRuntimeError(reject)) {
        return;
      }
      resolve(tab);
    });
  });
}
