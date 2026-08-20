/**
 * Barrel export for background handlers
 */

export {
  handleBeforeNavigate,
  handleNavigationChange,
  handleNavigationCommitted,
} from './navigation';
export type { NavigationChangeDetails } from './navigation';
export { handleMessage } from './messages';
