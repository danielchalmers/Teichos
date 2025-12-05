/**
 * Typed wrapper for chrome.tabs API
 */

/**
 * Update a tab's URL
 */
export async function updateTabUrl(
  tabId: number,
  url: string
): Promise<chrome.tabs.Tab> {
  return chrome.tabs.update(tabId, { url });
}

/**
 * Get the current active tab
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Get a tab by ID
 */
export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return chrome.tabs.get(tabId);
}
