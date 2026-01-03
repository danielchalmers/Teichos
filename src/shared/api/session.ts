/**
 * Typed wrapper for chrome.storage.session API
 */

const LAST_ALLOWED_URL_KEY_PREFIX = 'last_allowed_url_' as const;

function lastAllowedUrlKey(tabId: number): string {
  return `${LAST_ALLOWED_URL_KEY_PREFIX}${tabId}`;
}

/**
 * Store the last allowed URL for a tab in session storage
 */
export async function setLastAllowedUrl(tabId: number, url: string): Promise<void> {
  await chrome.storage.session.set({ [lastAllowedUrlKey(tabId)]: url });
}

/**
 * Get the last allowed URL for a tab from session storage
 */
export async function getLastAllowedUrl(tabId: number): Promise<string | undefined> {
  const key = lastAllowedUrlKey(tabId);
  const result = await chrome.storage.session.get(key);
  const value = result[key];
  return typeof value === 'string' ? value : undefined;
}
