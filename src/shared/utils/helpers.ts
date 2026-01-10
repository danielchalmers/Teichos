/**
 * Shared utility functions
 */

const INTERNAL_URL_PREFIXES = [
  'chrome-extension://',
  'chrome://',
  'chrome-untrusted://',
  'chrome-search://',
  'devtools://',
  'edge://',
  'edge-extension://',
  'edge-devtools://',
  'about:',
  'moz-extension://',
  'safari-extension://',
  'opera://',
  'brave://',
  'vivaldi://',
  'extension://',
  'view-source:',
] as const;

/**
 * Generate a unique ID
 * Uses crypto.randomUUID() if available, otherwise fallback
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}

/**
 * Format time as HH:MM
 */
export function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get current time as HH:MM string
 */
export function getCurrentTimeString(): string {
  const now = new Date();
  return formatTime(now.getHours(), now.getMinutes());
}

/**
 * Get current day of week (0-6, Sunday-Saturday)
 */
export function getCurrentDayOfWeek(): number {
  return new Date().getDay();
}

/**
 * Check if a URL is a browser/internal page that should not be filtered
 */
export function isInternalUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  const normalizedUrl = url.toLowerCase();
  return INTERNAL_URL_PREFIXES.some((prefix) => normalizedUrl.startsWith(prefix));
}
