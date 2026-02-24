/**
 * Background Service Worker Entry Point
 *
 * MV3 service worker constraints:
 * - Event-driven: terminates when idle
 * - No DOM access
 * - All listeners must be registered synchronously at the top level
 * - Use chrome.storage instead of localStorage
 */

import { handleBeforeNavigate, handleMessage } from './handlers';
import { registerSnoozeHandlers } from './snooze';

// Register all event listeners synchronously at top level
// This is critical for MV3 service workers

// Web navigation events - handle main frame navigations
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  handleBeforeNavigate(details).catch((error: unknown) => {
    console.error('[Teichos] Error handling navigation:', error);
  });
});

// Message handling from other extension contexts
chrome.runtime.onMessage.addListener(handleMessage);
registerSnoozeHandlers();

// Log initialization (will be stripped in production build)
console.log('[Teichos] Background service worker initialized');
