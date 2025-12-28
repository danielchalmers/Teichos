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
export function openOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Open the extension's options page with query params
 */
export function openOptionsPageWithParams(
  params: Record<string, string>
): Promise<chrome.tabs.Tab | undefined> {
  const url = new URL(getExtensionUrl('options/index.html'));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: url.toString() }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

/**
 * Get the extension's unique ID
 */
export function getExtensionId(): string {
  return chrome.runtime.id;
}
