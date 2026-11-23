/**
 * Barrel export for background handlers
 */

export { handleBeforeNavigate, handleNavigationChange, handleNavigationError } from './navigation';
export type { NavigationChangeDetails, NavigationErrorDetails } from './navigation';
export { handleMessage } from './messages';
export { handleInstalled } from './install';
