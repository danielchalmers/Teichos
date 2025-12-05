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
 * Get the extension's unique ID
 */
export function getExtensionId(): string {
  return chrome.runtime.id;
}
