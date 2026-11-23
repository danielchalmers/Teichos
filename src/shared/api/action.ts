/**
 * Typed wrapper for chrome.action API
 */

/**
 * Whether the toolbar icon is pinned. Only a clear "no" from Chrome counts as unpinned, so a
 * failed or unexpected answer never asks the user to pin an icon that may already be there.
 */
export async function isToolbarIconPinned(): Promise<boolean> {
  try {
    const settings: unknown = await chrome.action.getUserSettings();
    const unpinned =
      typeof settings === 'object' &&
      settings !== null &&
      'isOnToolbar' in settings &&
      settings.isOnToolbar === false;
    return !unpinned;
  } catch {
    return true;
  }
}

/**
 * Call `listener` when the user pins or unpins the toolbar icon. Chrome before 130 has no event
 * for it, hence the `?.`: there the answer is only read again the next time something asks.
 */
export function onToolbarIconPinChange(listener: () => void): void {
  chrome.action.onUserSettingsChanged?.addListener(() => {
    listener();
  });
}
